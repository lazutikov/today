/**
 * Free place search on OpenStreetMap data (Photon by komoot), any city.
 * Public API, no key: keep it gentle (debounced, at most ~1 request a second).
 */
import { cityKey, getSpot, isHomeCity, type Spot } from './area'

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

/** Tight boxes for the cities we know well; elsewhere search is just biased to the spot */
const BOXES: Record<string, string> = {
  lviv: '23.85,49.76,24.20,49.92',
  warsaw: '20.80,52.09,21.28,52.37',
}

/** Centre of the city the person is looking at */
export const cityCenter = () => {
  const s = getSpot()
  return { lat: s.lat, lon: s.lon }
}

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
  if (getSpot().key !== 'lviv' || !Number.isFinite(lat)) return undefined
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
  // Lviv: our own district names; elsewhere whatever district the map gives («Шевченківський район» → «Шевченківський»)
  const area =
    getSpot().key === 'lviv'
      ? (LVIV_AREAS.find(([re]) => re.test(text))?.[1] ?? nearestArea(lat, lon))
      : (p.district || p.city_district || '')
          .replace(/\s*(район|district|dzielnica)$/i, '')
          .replace(/^(район|dzielnica)\s+/i, '')
          .trim() || undefined
  return { name, address, lat, lon, area }
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const s = getSpot()
  const box = BOXES[s.key] ? `&bbox=${BOXES[s.key]}` : ''
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&lat=${s.lat}&lon=${s.lon}&zoom=13&limit=8${box}`
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

/* ---------- Cities and addresses anywhere (for "Звідки") ---------- */

export type SpotHit = Spot & { sub: string }

const CITY_TYPES = new Set(['city', 'town', 'village'])

function toSpot(f: Feature, mode: Spot['mode']): SpotHit {
  const p = f.properties
  const isCity = CITY_TYPES.has(p.type ?? '') || (p.osm_key === 'place' && CITY_TYPES.has(p.osm_value ?? ''))
  const city = (isCity ? p.name : p.city || p.town || p.village || p.name) || 'Точка на карті'
  const here = isCity ? '' : p.name || [p.street, p.housenumber].filter(Boolean).join(', ') || p.district || ''
  return {
    key: cityKey(city),
    city,
    label: here ? `${city}, ${here}` : city,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    mode,
    precise: !isCity,
    sub: [isCity ? p.state || p.county : [p.street, p.district].filter(Boolean).join(', '), p.country].filter(Boolean).join(', '),
  }
}

/** Search cities first, then addresses, anywhere, biased to where the person is now */
export async function searchSpots(q: string, near: { lat: number; lon: number }, signal?: AbortSignal) {
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&lat=${near.lat}&lon=${near.lon}&limit=8`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('search_failed')
  const body = (await res.json()) as { features: Feature[] }
  const hits = body.features.map((f) => toSpot(f, 'manual'))
  return hits.sort((a, b) => Number(a.precise) - Number(b.precise))
}

/** The city around a GPS point (for the automatic "Звідки") */
export async function spotAt(lat: number, lon: number, signal?: AbortSignal): Promise<Spot> {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`, { signal })
  if (!res.ok) throw new Error('reverse_failed')
  const body = (await res.json()) as { features: Feature[] }
  const f = body.features[0]
  const p = f?.properties ?? {}
  const city = p.city || p.town || p.village || p.name || 'Тут'
  const district = isHomeCity({ key: cityKey(city) }) ? (nearestArea(lat, lon) ?? '') : ''
  return {
    key: cityKey(city),
    city,
    label: district && district !== 'Центр' ? `${city}, ${district}` : city,
    lat,
    lon,
    mode: 'auto',
    precise: true,
  }
}

/** "біля Ботсаду", "Сихів": a neighbourhood-ish name for a point, never a street number */
export async function nearLabel(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`, { signal })
    const f = ((await res.json()) as { features: Feature[] }).features[0]
    const p = f?.properties ?? {}
    const raw = p.locality || p.district || p.street || p.city || ''
    const clean = raw.replace(/\s*район$/i, '').trim()
    if (clean) return p.street && raw === p.street ? `біля ${clean.replace(/^вулиця /i, 'вул. ')}` : clean
  } catch {
    /* fall through */
  }
  return nearestArea(lat, lon) ?? 'поруч'
}
