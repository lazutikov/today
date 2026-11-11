/**
 * Free place search for Lviv/Warsaw on OpenStreetMap data (Photon by komoot).
 * Public API, no key: keep it gentle (debounced, at most ~1 request a second).
 */
import { CITY } from './feed'

export type Place = {
  /** What people will see: venue name, or street and number */
  name: string
  /** Street, house, district: helps to find it */
  address: string
  lat: number
  lon: number
  /** Our district name if we could tell it from the address */
  area?: string
}

const CITIES = {
  lviv: { lat: 49.8397, lon: 24.0297, bbox: '23.85,49.76,24.20,49.92' },
  warsaw: { lat: 52.2297, lon: 21.0122, bbox: '20.80,52.09,21.28,52.37' },
} as const

export const CITY_CENTER = CITIES[CITY]

const PHOTON = 'https://photon.komoot.io'

type Feature = {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | undefined>
}

// OSM raions → our districts (Lviv); "Центр" is Halytskyi
const LVIV_AREAS: [RegExp, string][] = [
  [/галицьк/i, 'Центр'],
  [/франківськ/i, 'Франківський'],
  [/личаківськ/i, 'Личаківський'],
  [/сихівськ/i, 'Сихівський'],
  [/шевченківськ/i, 'Шевченківський'],
  [/залізничн/i, 'Залізничний'],
]

// Rough centres of Lviv districts: when the address has no district, the nearest centre decides.
const LVIV_CENTRES: [string, number, number][] = [
  ['Центр', 49.8415, 24.0315],
  ['Франківський', 49.8235, 23.9985],
  ['Личаківський', 49.8335, 24.0705],
  ['Сихівський', 49.7935, 24.0555],
  ['Шевченківський', 49.8695, 24.0255],
  ['Залізничний', 49.8390, 23.9720],
]

export function nearestArea(lat: number, lon: number): string | undefined {
  if (CITY !== 'lviv' || !Number.isFinite(lat)) return undefined
  const k = Math.cos((lat * Math.PI) / 180) // lon degrees are shorter at this latitude
  let best: [string, number] | null = null
  for (const [name, la, lo] of LVIV_CENTRES) {
    const d = (lat - la) ** 2 + ((lon - lo) * k) ** 2
    if (!best || d < best[1]) best = [name, d]
  }
  return best?.[0]
}

function toPlace(f: Feature): Place {
  const p = f.properties
  const street = [p.street, p.housenumber].filter(Boolean).join(', ')
  const name = p.name || street || p.district || p.locality || 'Точка на карті'
  const address = [p.name ? street : '', p.district || p.locality, p.city && p.city !== name ? p.city : '']
    .filter(Boolean)
    .join(', ')
  const text = [p.district, p.locality, p.county].filter(Boolean).join(' ')
  const lat = f.geometry.coordinates[1]
  const lon = f.geometry.coordinates[0]
  const area = CITY === 'lviv' ? (LVIV_AREAS.find(([re]) => re.test(text))?.[1] ?? nearestArea(lat, lon)) : undefined
  return { name, address, lat, lon, area }
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const c = CITY_CENTER
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&lat=${c.lat}&lon=${c.lon}&zoom=13&limit=8&bbox=${c.bbox}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('search_failed')
  const body = (await res.json()) as { features: Feature[] }
  return body.features.map(toPlace)
}

export async function placeAt(lat: number, lon: number, signal?: AbortSignal): Promise<Place> {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`, { signal })
  if (!res.ok) throw new Error('reverse_failed')
  const body = (await res.json()) as { features: Feature[] }
  const f = body.features[0]
  // Keep the exact pin, take only the naming from the nearest object
  return f
    ? { ...toPlace(f), lat, lon }
    : { name: 'Точка на карті', address: '', lat, lon, area: nearestArea(lat, lon) }
}

/** Opens directions in whatever maps app the phone has. */
export function mapsLink(p: { lat: number; lon: number; name?: string }) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`
}
