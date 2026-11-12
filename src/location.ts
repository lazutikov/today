/**
 * "How far is it": the person's position stays on the phone. It's asked only
 * on a tap (or reused if permission was already given) and kept for 30 minutes.
 */
import { useEffect, useState } from 'react'
import { cityCenter } from './places'

/** Further than this from the city centre, distances mean nothing: hide them. */
const MAX_FROM_CITY_KM = 30

export type Coords = { lat: number; lon: number }

const KEY = 'today.myLocation'
const FRESH_MS = 30 * 60 * 1000

export function distanceKm(a: Coords, b: Coords): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * What people actually decide on: time to get there. Walking (~4.8 km/h with
 * ~30% detours) up to 25 min, otherwise a taxi (~25 km/h in town + pickup).
 */
export function travelLabel(km: number): string {
  if (km > MAX_FROM_CITY_KM) return formatDistance(km) // out of town: just the distance
  const walk = ((km * 1.3) / 4.8) * 60
  const round = (m: number) => (m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5)
  if (walk <= 25) return `~${round(walk)} хв пішки`
  return `~${round(((km * 1.4) / 25) * 60 + 4)} хв на таксі`
}

/** About 300 m grid: a block, not a building */
export function roundPoint<T extends Coords>(c: T): T {
  const r = (v: number) => Math.round(v / 0.003) * 0.003
  return { ...c, lat: Number(r(c.lat).toFixed(3)), lon: Number(r(c.lon).toFixed(3)) }
}

/** 450 м · 1,2 км · 12 км */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} м`
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} км`
  return `${Math.round(km)} км`
}

function saved(): Coords | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null') as (Coords & { at: number }) | null
    return v && Date.now() - v.at < FRESH_MS ? { lat: v.lat, lon: v.lon } : null
  } catch {
    return null
  }
}

function locate(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) return reject(new Error('unavailable'))
    const ok = (p: GeolocationPosition) => {
      const c = { lat: p.coords.latitude, lon: p.coords.longitude }
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now() }))
      } catch {
        /* memory only */
      }
      resolve(c)
    }
    // Network position is quick and plenty for "1,2 км"
    navigator.geolocation.getCurrentPosition(ok, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60000 })
  })
}

export type LocState = 'unknown' | 'asking' | 'on' | 'denied' | 'off' | 'far'

/** Is this person in town? (far away we show plain km instead of time to get there) */
export const inCity = (c: Coords) => distanceKm(c, cityCenter()) <= MAX_FROM_CITY_KM

/** My position for distances: silent if already allowed, otherwise on request(). */
export function useMyLocation() {
  const [coords, setCoordsRaw] = useState<Coords | null>(saved)
  const [state, setState] = useState<LocState>(coords ? 'on' : 'unknown')
  const setCoords = (c: Coords) => {
    setCoordsRaw(c)
    return true
  }

  useEffect(() => {
    if (coords) return
    // Already allowed earlier: no prompt will show, so just take it
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') locate().then((c) => setCoords(c) && setState('on')).catch(() => {})
        else if (p.state === 'denied') setState('denied')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const request = () => {
    setState('asking')
    locate()
      .then((c) => {
        if (setCoords(c)) setState('on')
      })
      .catch((e: GeolocationPositionError | Error) => setState('code' in e && e.code === 1 ? 'denied' : 'off'))
  }

  return { coords, state, request }
}

/** Where a card is: the venue for a plan, the rough point for free time */
export function cardPoint(c: { lat?: number; lon?: number; near?: Coords & { exact?: boolean } }): Coords | null {
  if (c.lat !== undefined && c.lon !== undefined) return { lat: c.lat, lon: c.lon }
  return c.near ? { lat: c.near.lat, lon: c.near.lon } : null
}
