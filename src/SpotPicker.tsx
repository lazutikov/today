/**
 * "Звідки" like in a taxi app: my location by default, or any city / address
 * to see plans there. Choosing changes the feed and where travel times start.
 */
import { useEffect, useState } from 'react'
import { HOME_SPOT, setSpot, type Spot } from './area'
import { searchSpots, spotAt, type SpotHit } from './places'
import { BackIcon, PinIcon } from './ui'

export function SpotPicker({ current, onClose }: { current: Spot; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SpotHit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      searchSpots(q.trim(), current, ctrl.signal)
        .then((r) => {
          setHits(r)
          setError(null)
        })
        .catch((e) => e.name !== 'AbortError' && setError('Пошук зараз не відповідає. Спробуй за хвилину.'))
    }, 400)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [q, current])

  const pick = (s: Spot) => {
    setSpot(s)
    onClose()
  }

  const useMine = () => {
    if (!navigator.geolocation) return setError('Цей браузер не дає визначити, де ти.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) =>
        spotAt(p.coords.latitude, p.coords.longitude)
          .then(pick)
          .catch(() => pick({ ...HOME_SPOT, lat: p.coords.latitude, lon: p.coords.longitude, precise: true }))
          .finally(() => setLocating(false)),
      (e) => {
        setLocating(false)
        setError(
          e.code === 1
            ? 'Геолокацію вимкнено. Увімкни: 🔒 біля адреси сайту → Дозволи → Місцезнаходження.'
            : 'Не вдалося визначити, де ти. Обери місто пошуком.',
        )
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60000 },
    )
  }

  return (
    <div className="npage spot-page" role="dialog" aria-modal="true" aria-label="Звідки дивитись плани">
      <header className="spot-head">
        <button className="profile-btn" onClick={onClose} aria-label="Назад">
          <BackIcon />
        </button>
        <input
          className="picker-search"
          placeholder="Місто або адреса"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          autoFocus
        />
      </header>

      <ul className="spot-list">
        <li>
          <button className="spot-item" onClick={useMine} disabled={locating}>
            <span className="spot-ico spot-ico-me" aria-hidden="true">
              <PinIcon />
            </span>
            <span>
              <b>{locating ? 'Шукаю, де ти…' : 'Моя локація'}</b>
              <span>Плани поруч і скільки до них добиратися</span>
            </span>
          </button>
        </li>
        {current.key !== HOME_SPOT.key && q.trim().length < 2 && (
          <li>
            <button className="spot-item" onClick={() => pick({ ...HOME_SPOT, mode: 'manual' })}>
              <span className="spot-ico" aria-hidden="true">
                <PinIcon />
              </span>
              <span>
                <b>{HOME_SPOT.city}</b>
                <span>Тут ми запускаємось</span>
              </span>
            </button>
          </li>
        )}
        {hits.map((h, i) => (
          <li key={`${h.lat},${h.lon},${i}`}>
            <button className="spot-item" onClick={() => pick(h)}>
              <span className="spot-ico" aria-hidden="true">
                <PinIcon />
              </span>
              <span>
                <b>{h.label}</b>
                {h.sub && <span>{h.sub}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="spot-error">{error}</p>}
      <p className="spot-note">Твоє місцезнаходження лишається на телефоні: ми бачимо тільки місто.</p>
    </div>
  )
}
