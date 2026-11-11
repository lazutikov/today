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

function toPlace(f: Feature): Place {
  const p = f.properties
  const street = [p.street, p.housenumber].filter(Boolean).join(', ')
  const name = p.name || street || p.district || p.locality || 'Точка на карті'
  const address = [p.name ? street : '', p.district || p.locality, p.city && p.city !== name ? p.city : '']
    .filter(Boolean)
    .join(', ')
  const text = [p.district, p.locality, p.county].filter(Boolean).join(' ')
  const area = CITY === 'lviv' ? LVIV_AREAS.find(([re]) => re.test(text))?.[1] : undefined
  return { name, address, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], area }
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
  return f ? { ...toPlace(f), lat, lon } : { name: 'Точка на карті', address: '', lat, lon }
}

/** Opens directions in whatever maps app the phone has. */
export function mapsLink(p: { lat: number; lon: number; name?: string }) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`
}
