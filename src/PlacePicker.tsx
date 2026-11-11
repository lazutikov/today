/**
 * Pick a place like in a taxi app: the pin stays in the middle, the map moves
 * under it; search with suggestions on top. Map: MapLibre + OpenFreeMap tiles.
 */
import 'maplibre-gl/dist/maplibre-gl.css'
import * as maplibregl from 'maplibre-gl'
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
  const map = useRef<maplibregl.Map | null>(null)
  const [place, setPlace] = useState<Place | null>(initial ?? null)
  const [resolving, setResolving] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [searchError, setSearchError] = useState(false)
  const [mapError, setMapError] = useState(false)
  const skipReverse = useRef(Boolean(initial))

  // Map
  useEffect(() => {
    if (!box.current) return
    const start = initial ?? { lat: CITY_CENTER.lat, lon: CITY_CENTER.lon }
    let m: maplibregl.Map
    try {
      m = new maplibregl.Map({
        container: box.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [start.lon, start.lat],
        zoom: initial ? 16 : 13.5,
        attributionControl: { compact: true },
      })
    } catch {
      setMapError(true)
      return
    }
    map.current = m
    // Fall back only if the map never comes up (no WebGL, tiles blocked), not on one missing tile
    let loaded = false
    m.once('load', () => (loaded = true))
    const giveUp = window.setTimeout(() => !loaded && setMapError(true), 12000)

    let ctrl: AbortController | null = null
    let timer = 0
    m.on('moveend', () => {
      if (skipReverse.current) {
        skipReverse.current = false
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const c = m.getCenter()
        ctrl?.abort()
        ctrl = new AbortController()
        setResolving(true)
        placeAt(c.lat, c.lng, ctrl.signal)
          .then(setPlace)
          .catch(() => setPlace({ name: 'Точка на карті', address: '', lat: c.lat, lon: c.lng }))
          .finally(() => setResolving(false))
      }, 600)
    })
    if (!initial) m.once('load', () => m.fire('moveend'))
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
    map.current?.flyTo({ center: [p.lon, p.lat], zoom: 16.5, duration: 600 })
  }

  const locateMe = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 }),
      () => {},
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
          <p className="picker-hint">Тільки публічні місця: кав’ярні, бари, парки.</p>
          <button className="dbtn" disabled={!place || resolving} onClick={() => place && onPick(place)}>
            Обрати це місце
          </button>
        </div>
      )}
    </div>
  )
}
