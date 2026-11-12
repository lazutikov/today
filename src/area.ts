/**
 * "Where am I looking": the city (and maybe an exact spot) the feed is about.
 * Like "Звідки" in a taxi app: by default it follows the phone's location,
 * but the person can pick any city or address to see plans there.
 * The position never leaves the phone; the server only gets the city key.
 */
import { useEffect, useState } from 'react'
import { CITY } from './feed'

export type Spot = {
  /** Server key of the city: 'lviv', 'warsaw', or the lowercased local name ('київ') */
  key: string
  /** City name as people say it: «Львів» */
  city: string
  /** What the header shows: «Львів» or «Львів, Сихів» */
  label: string
  lat: number
  lon: number
  /** auto = follows the phone; manual = picked by hand */
  mode: 'auto' | 'manual'
  /** A real point (my location or an address), not just a city centre: distances make sense */
  precise: boolean
}

const HOME: Record<string, Spot> = {
  lviv: { key: 'lviv', city: 'Львів', label: 'Львів', lat: 49.8397, lon: 24.0297, mode: 'auto', precise: false },
  warsaw: { key: 'warsaw', city: 'Варшава', label: 'Варшава', lat: 52.2297, lon: 21.0122, mode: 'auto', precise: false },
}

/** City we launched in (demo cards, districts): the one from the link, Lviv by default */
export const HOME_SPOT = HOME[CITY] ?? HOME.lviv

/** One key per city, whatever language the map answers in */
export function cityKey(name: string): string {
  const n = name.trim().toLowerCase()
  if (/^(львів|львов|lviv|lwów|lwow|lemberg)$/.test(n)) return 'lviv'
  if (/^(варшава|warszawa|warsaw)$/.test(n)) return 'warsaw'
  if (/^(харків|харьков|kharkiv|kharkov|charków)$/.test(n)) return 'kharkiv'
  return n.slice(0, 40)
}

/** Is this the city with our districts and demo cards? */
export const isHomeCity = (s: Pick<Spot, 'key'>) => s.key === HOME_SPOT.key

const KEY = 'today.spot'

function load(): Spot {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Spot | null
    if (s && typeof s.lat === 'number' && s.key) return s
  } catch {
    /* fall through */
  }
  return HOME_SPOT
}

let current: Spot = load()
const listeners = new Set<(s: Spot) => void>()

export function getSpot(): Spot {
  return current
}

export function setSpot(next: Spot) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* memory only */
  }
  listeners.forEach((l) => l(next))
}

export function useSpot(): Spot {
  const [s, set] = useState(current)
  useEffect(() => {
    listeners.add(set)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}
