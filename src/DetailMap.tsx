/**
 * Small, still map in a card's details.
 * Plan: a pin on the venue, tap opens directions.
 * Free time from GPS: a soft circle "somewhere here" (rounded to ~300 m), never a pin.
 * My position, when known, is a small dark dot.
 */
import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { distanceKm, type Coords } from './location'

const PIN = L.divIcon({
  className: 'dmap-pin',
  html: '<svg viewBox="0 0 24 32" width="28" height="36" aria-hidden="true"><path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z" fill="#FF5F1F"/><circle cx="12" cy="11.5" r="4.5" fill="#fff"/></svg>',
  iconSize: [28, 36],
  iconAnchor: [14, 36],
})

export default function DetailMap({
  point,
  area,
  me,
  href,
}: {
  point: Coords
  /** Rough point: draw a circle, not a pin */
  area?: boolean
  me?: Coords | null
  /** Directions link for a venue */
  href?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    })
    let loaded = false
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    })
      .on('tileload', () => (loaded = true))
      .addTo(m)
    m.attributionControl.setPrefix(false)
    const giveUp = window.setTimeout(() => !loaded && setFailed(true), 12000)

    const p = L.latLng(point.lat, point.lon)
    if (area) {
      L.circle(p, { radius: 330, stroke: false, fillColor: '#FF5F1F', fillOpacity: 0.22, interactive: false }).addTo(m)
    } else {
      L.marker(p, { icon: PIN, interactive: false, keyboard: false }).addTo(m)
    }
    const nearMe = me && distanceKm(me, point) < 8
    if (me && nearMe) {
      L.circleMarker([me.lat, me.lon], {
        radius: 6,
        color: '#fff',
        weight: 3,
        fillColor: '#111',
        fillOpacity: 1,
        interactive: false,
      }).addTo(m)
    }
    const fit = () => {
      m.invalidateSize()
      // Show me too only if both fit without shrinking the place to a dot
      const minZoom = area ? 13 : 14
      if (me && nearMe) {
        const b = L.latLngBounds([p, [me.lat, me.lon]])
        if (area) b.extend(p.toBounds(700))
        const z = m.getBoundsZoom(b, false, L.point(64, 80))
        if (z >= minZoom) return m.fitBounds(b, { paddingTopLeft: [32, area ? 24 : 52], paddingBottomRight: [32, area ? 56 : 40], maxZoom: 16 })
      }
      m.setView(p, area ? 13 : 15)
    }
    fit()
    // The sheet slides in: sizes settle a moment later
    const t = window.setTimeout(fit, 350)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(giveUp)
      m.remove()
    }
  }, [point.lat, point.lon, area, me?.lat, me?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return null
  return (
    <div className="dmap">
      <div ref={box} className="dmap-box" />
      {href && (
        <a className="dmap-route" href={href} target="_blank" rel="noopener">
          Маршрут
        </a>
      )}
      {area && <span className="dmap-note">Десь тут, ±300 м</span>}
    </div>
  )
}
