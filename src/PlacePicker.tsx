/**
 * Pick a place like in a taxi app: the pin stays in the middle, the map moves
 * under it; search with suggestions on top. Map: Leaflet + OpenStreetMap's own
 * tiles (plain images, no key, no WebGL or workers, works on any phone). Their
 * usage policy fits light traffic like ours; switch to a keyed provider at scale.
 */
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { CITY_CENTER, placeAt, searchPlaces, type Place } from './places'
import { BackIcon } from './ui'

export default function PlacePicker({
  initial,
  onPick,
  onClose,
}: {
  initial?: Place | null
  onPick: (p: Place) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [place, setPlace] = useState<Place | null>(initial ?? null)
  const [resolving, setResolving] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [searchError, setSearchError] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const skipReverse = useRef(Boolean(initial))

  // Map
  useEffect(() => {
    if (!box.current) return
    const start = initial ?? { lat: CITY_CENTER.lat, lon: CITY_CENTER.lon }
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView(
      [start.lat, start.lon],
      initial ? 17 : 14,
    )
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    })
      .on('tileload', () => (loaded = true))
      .addTo(m)
    m.attributionControl.setPrefix(false)
    map.current = m

    // Fall back only if not a single tile arrives (offline, blocked network)
    let loaded = false
    const giveUp = window.setTimeout(() => !loaded && setMapError(true), 12000)

    let ctrl: AbortController | null = null
    let timer = 0
    const lookup = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const c = m.getCenter()
        ctrl?.abort()
        ctrl = new AbortController()
        setResolving(true)
        placeAt(c.lat, c.lng, ctrl.signal)
          .then(setPlace)
          .catch((e) => e.name !== 'AbortError' && setPlace({ name: 'Точка на карті', address: '', lat: c.lat, lon: c.lng }))
          .finally(() => setResolving(false))
      }, 600)
    }
    m.on('moveend', () => {
      if (skipReverse.current) {
        skipReverse.current = false
        return
      }
      lookup()
    })
    if (!initial) lookup()
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(giveUp)
      ctrl?.abort()
      m.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search as you type (debounced; Photon is a shared free service)
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      searchPlaces(q.trim(), ctrl.signal)
        .then((r) => {
          setResults(r)
          setSearchError(false)
        })
        .catch((e) => e.name !== 'AbortError' && setSearchError(true))
    }, 400)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  const choose = (p: Place) => {
    if (mapError) return onPick(p) // no map to confirm on: a found place is precise enough
    setPlace(p)
    setResults([])
    setQ('')
    skipReverse.current = true
    map.current?.flyTo([p.lat, p.lon], 17, { duration: 0.6 })
  }

  const locateMe = () => {
    const fail = () => setNote('Не вдалося визначити, де ти. Знайди місце через пошук або посунь карту.')
    if (!navigator.geolocation) return fail()
    setNote('Шукаю, де ти…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNote(null)
        map.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 17, { duration: 0.6 })
      },
      fail,
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  // No map (old phone, blocked network): naming the place by hand still works
  const typedPlace: Place | null =
    q.trim().length >= 2 ? { name: q.trim(), address: '', lat: NaN, lon: NaN } : null

  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label="Обрати місце">
      <div className="picker-map" ref={box} />
      {!mapError && <span className="picker-pin" aria-hidden="true" />}

      <div className="picker-top">
        <button className="profile-btn" onClick={onClose} aria-label="Назад">
          <BackIcon />
        </button>
        <input
          className="picker-search"
          placeholder="Кав’ярня, бар, парк або адреса"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {(results.length > 0 || searchError || (mapError && typedPlace)) && (
        <ul className="picker-results" role="listbox" aria-label="Знайдені місця">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lon},${i}`}>
              <button role="option" aria-selected="false" onClick={() => choose(r)}>
                <b>{r.name}</b>
                {r.address && <span>{r.address}</span>}
              </button>
            </li>
          ))}
          {searchError && <li className="picker-note">Пошук зараз не відповідає. Посунь карту до місця.</li>}
          {mapError && typedPlace && (
            <li>
              <button onClick={() => onPick(typedPlace)}>
                <b>Назвати місце «{typedPlace.name}»</b>
                <span>Карта не завантажилась, збережемо просто назву</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {mapError && !typedPlace && (
        <p className="picker-fallback">Карта не завантажилась. Напиши назву місця вгорі.</p>
      )}

      {!mapError && (
        <div className="picker-sheet">
          <button className="picker-locate" onClick={locateMe}>
            Де я зараз
          </button>
          <div className="picker-place" aria-live="polite">
            <b>{resolving ? 'Шукаю, що тут…' : (place?.name ?? 'Посунь карту до місця')}</b>
            {!resolving && place?.address && <span>{place.address}</span>}
          </div>
          <p className="picker-hint" aria-live="polite">{note ?? 'Тільки публічні місця: кав’ярні, бари, парки.'}</p>
          <button className="dbtn" disabled={!place || resolving} onClick={() => place && onPick(place)}>
            Обрати це місце
          </button>
        </div>
      )}
    </div>
  )
}
