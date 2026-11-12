/**
 * "Звідки ти" for a free-time post or "Мої місця" in the profile: a rough point
 * (my location now, or a place picked on the map) shown only as a label.
 */
import { lazy, Suspense, useState } from 'react'
import { roundPoint } from './location'
import { nearLabel } from './places'
import { PinIcon } from './ui'

const PlacePicker = lazy(() => import('./PlacePicker'))

export type Near = { lat: number; lon: number; label: string }

export function NearField({
  value,
  onChange,
  placeholder = 'Обери, звідки тобі зручно',
}: {
  value: Near | null
  onChange: (n: Near) => void
  placeholder?: string
}) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const here = () => {
    if (!navigator.geolocation) return setNote('Цей браузер не дає визначити, де ти. Обери на карті.')
    setBusy(true)
    setNote(null)
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const pt = roundPoint({ lat: p.coords.latitude, lon: p.coords.longitude })
        onChange({ ...pt, label: await nearLabel(pt.lat, pt.lon) })
        setBusy(false)
      },
      (e) => {
        setBusy(false)
        setNote(
          e.code === 1
            ? 'Геолокацію вимкнено (🔒 біля адреси сайту → Дозволи). Або обери на карті.'
            : 'Не вдалося визначити. Обери на карті.',
        )
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60000 },
    )
  }

  return (
    <>
      <div className={value ? 'place-btn' : 'place-btn empty'}>
        <b>
          <PinIcon /> {value ? value.label : placeholder}
        </b>
        <span>Інші бачать тільки цю назву і відстань, не точку.</span>
      </div>
      <div className="near-actions">
        <button className="dchip" onClick={here} disabled={busy}>
          {busy ? 'Шукаю…' : 'Де я зараз'}
        </button>
        <button className="dchip" onClick={() => setPicking(true)}>
          Обрати на карті
        </button>
      </div>
      {note && <p className="dhint dhint-left">{note}</p>}
      {picking && (
        <Suspense fallback={null}>
          <PlacePicker
            initial={null}
            onClose={() => setPicking(false)}
            onPick={(pl) => {
              setPicking(false)
              if (!Number.isFinite(pl.lat)) return setNote('Без карти не вийде, спробуй «Де я зараз».')
              const pt = roundPoint({ lat: pl.lat, lon: pl.lon })
              onChange({ ...pt, label: pl.name })
            }}
          />
        </Suspense>
      )}
    </>
  )
}

/** "Готовий доїхати" / "Писати про плани в радіусі" */
export function ReachChips({ value, onChange, options = [2, 5, 10] }: { value: number; onChange: (km: number) => void; options?: number[] }) {
  return (
    <div className="dchips" role="radiogroup">
      {options.map((km) => (
        <button
          key={km}
          role="radio"
          aria-checked={value === km}
          className={value === km ? 'dchip on' : 'dchip'}
          onClick={() => onChange(km)}
        >
          до {km} км
        </button>
      ))}
    </div>
  )
}
