/**
 * /safe?t=… — what a trusted person sees during someone's meeting:
 * where, when, with whom, and the last position from the bot's live location.
 * No sign-in; the link itself is the key and stops working after the meeting.
 */
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/unbounded/700.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import './safe.css'

type View = {
  name: string
  time: string
  place: string
  address?: string
  withName?: string
  withAge?: number
  venue?: { lat: number; lon: number }
  until: number
  live: boolean
  last?: { lat: number; lon: number; at: number }
  alarm: { kind: string; at: number; text: string } | null
}

const token = new URLSearchParams(location.search).get('t') ?? ''
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000)
  return m < 1 ? 'щойно' : m < 60 ? `${m} хв тому` : `о ${hhmm(ms)}`
}

function MapBox({ v }: { v: View }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    m.attributionControl.setPrefix(false)
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    return () => {
      m.remove()
      map.current = null
    }
  }, [])
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const pts: L.LatLngExpression[] = []
    if (v.venue) {
      L.circleMarker([v.venue.lat, v.venue.lon], { radius: 7, color: '#141414', weight: 3, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(v.place)
        .addTo(g)
      pts.push([v.venue.lat, v.venue.lon])
    }
    if (v.last) {
      const fresh = Date.now() - v.last.at < 15 * 60000
      L.circleMarker([v.last.lat, v.last.lon], {
        radius: 9,
        color: '#fff',
        weight: 3,
        fillColor: fresh ? '#fc601e' : '#8a8a8a',
        fillOpacity: 1,
      })
        .bindTooltip(`${v.name}, ${ago(v.last.at)}`)
        .addTo(g)
      pts.push([v.last.lat, v.last.lon])
    }
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 })
    else if (pts.length) m.setView(pts[0], 15)
    else m.setView([49.8397, 24.0297], 12)
  }, [v])
  return <div ref={box} className="map" />
}

function App() {
  const [v, setV] = useState<View | null>(null)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => {
      const r = await fetch(`/api/safety?t=${encodeURIComponent(token)}`).then((x) => x.json()).catch(() => null)
      if (!alive) return
      if (r?.ok) setV(r.view as View)
      else if (r) setGone(true)
    }
    load()
    const id = window.setInterval(load, 30000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  if (gone)
    return (
      <main className="page">
        <div className="brand">today</div>
        <h1>Зустріч завершилась</h1>
        <p className="muted">Це посилання більше не показує геопозицію. Якщо щось трапиться, вам напишуть у Telegram.</p>
      </main>
    )
  if (!v)
    return (
      <main className="page">
        <div className="brand">today</div>
        <p className="muted">Завантажуємо…</p>
      </main>
    )

  const status = v.alarm ? (
    <span className="badge alarm">● Тривога</span>
  ) : v.last ? (
    Date.now() - v.last.at < 15 * 60000 ? (
      <span className="badge ok">● Наживо · {ago(v.last.at)}</span>
    ) : (
      <span className="badge off">Остання геопозиція {ago(v.last.at)}</span>
    )
  ) : (
    <span className="badge off">Чекаємо геопозицію</span>
  )

  return (
    <main className="page">
      <div className="top">
        <div className="brand">today</div>
        {status}
      </div>
      {v.alarm && (
        <div className="alert" role="alert">
          <b>{v.name} не відповідає</b>
          {v.name} {v.alarm.text}. Остання геопозиція на карті. Подзвоніть. Якщо не відповідає — 112.
        </div>
      )}
      <MapBox v={v} />
      <section className="card">
        <h1>{v.name} на зустрічі</h1>
        <p>
          <b>Сьогодні о {v.time}</b> <span className="muted">· підстраховка до {hhmm(v.until)}</span>
        </p>
        <p>
          📍 {v.place}
          {v.address ? `, ${v.address}` : ''}
        </p>
        {v.withName && (
          <p>
            👤 З ким: {v.withName}
            {v.withAge ? `, ${v.withAge}` : ''}
          </p>
        )}
        {v.venue && (
          <a className="route" href={`https://www.google.com/maps/dir/?api=1&destination=${v.venue.lat},${v.venue.lon}`} target="_blank" rel="noopener">
            Маршрут до місця
          </a>
        )}
      </section>
      <p className="muted small">
        Сторінка оновлюється сама. Якщо {v.name} не відповідатиме, вам напишуть у Telegram. Після зустрічі посилання перестане
        працювати.
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
