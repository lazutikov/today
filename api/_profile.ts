/**
 * Profiles keyed by Telegram id, so a person keeps bio, districts, gender,
 * age and notification choice on any device. Districts also feed the
 * "new plan near you" pings.
 */
import { cleanCity, cleanNear, km, kv, type Near } from './_kv.js'

export type ServerProfile = {
  bio: string
  areas: string[]
  gender?: 'Чоловік' | 'Жінка'
  age?: number
  /** Bot may message about new plans in my districts (default on) */
  notify: boolean
  /** «Мої місця»: up to 2 rough points, and how far from them pings reach */
  places?: Near[]
  radius?: number
  interests?: string[]
  when?: ('weekday' | 'weekend')[]
  company?: 'one' | 'group' | 'any'
  city: string
  updatedAt: number
}

/** Any of these means "the whole city": such people hear about every post. */
export const WHOLE = new Set(['Весь Львів', 'Cała Warszawa', 'Все місто'])

const areaKey = (city: string, area: string) => `area:${city}:${area}`
const subsKey = (city: string) => `subs:${city}`

export function cleanProfile(input: Record<string, unknown>): ServerProfile {
  const areas = Array.isArray(input.areas)
    ? input.areas.filter((a): a is string => typeof a === 'string' && a.length <= 40).slice(0, 3)
    : []
  const age = Number(input.age)
  return {
    bio: typeof input.bio === 'string' ? input.bio.trim().slice(0, 300) : '',
    areas,
    gender: input.gender === 'Чоловік' || input.gender === 'Жінка' ? input.gender : undefined,
    age: Number.isFinite(age) && age >= 16 && age < 100 ? Math.round(age) : undefined,
    notify: input.notify !== false,
    places: Array.isArray(input.places)
      ? input.places.map(cleanNear).filter((x): x is Near => Boolean(x)).slice(0, 2)
      : [],
    radius: [2, 5, 10].includes(Number(input.radius)) ? Number(input.radius) : 5,
    interests: Array.isArray(input.interests)
      ? input.interests.filter((t): t is string => typeof t === 'string' && t.length <= 20).slice(0, 7)
      : [],
    when: Array.isArray(input.when) ? input.when.filter((w): w is 'weekday' | 'weekend' => w === 'weekday' || w === 'weekend') : [],
    company: input.company === 'one' || input.company === 'group' ? input.company : 'any',
    city: cleanCity(input.city),
    updatedAt: Date.now(),
  }
}

export async function getProfile(userId: number): Promise<ServerProfile | null> {
  const raw = (await kv('GET', `profile:${userId}`)) as string | null
  return raw ? (JSON.parse(raw) as ServerProfile) : null
}

export async function saveProfileServer(userId: number, p: ServerProfile) {
  const old = await getProfile(userId)
  // Keep the district index in step: who should hear about a post in which district
  for (const a of old?.areas ?? []) await kv('SREM', areaKey(old!.city, a), userId)
  if (old) await kv('SREM', subsKey(old.city), userId)
  if (p.notify && p.places?.length) await kv('SADD', subsKey(p.city), userId)
  // Old profiles (districts, no points) still hear by district
  else if (p.notify) for (const a of p.areas) await kv('SADD', areaKey(p.city, a), userId)
  await kv('SET', `profile:${userId}`, JSON.stringify(p), 'EX', 180 * 86400)
}

export async function setNotify(userId: number, on: boolean) {
  const p = await getProfile(userId)
  if (!p) return
  await saveProfileServer(userId, { ...p, notify: on, updatedAt: Date.now() })
}

/**
 * Who hears about a post: people whose «Мої місця» are within their radius
 * (or the poster's reach, if larger) of the post's point, plus old
 * district-based profiles.
 */
export async function audienceFor(
  city: string,
  postAreas: string[],
  point?: { lat: number; lon: number },
  reach = 0,
): Promise<number[]> {
  const near: number[] = []
  if (point) {
    const ids = ((await kv('SMEMBERS', subsKey(city))) as string[]).map(Number)
    const profiles = await Promise.all(ids.map((id) => getProfile(id)))
    profiles.forEach((pr, i) => {
      const r = Math.max(pr?.radius ?? 5, reach)
      if (pr?.notify && pr.places?.some((pl) => km(pl, point) <= r)) near.push(ids[i])
    })
  }
  return [...new Set([...near, ...(await audienceByArea(city, postAreas))])]
}

async function audienceByArea(city: string, postAreas: string[]): Promise<number[]> {
  const keys = new Set<string>()
  for (const w of WHOLE) keys.add(areaKey(city, w))
  for (const a of postAreas) keys.add(areaKey(city, a))
  // A post for the whole city reaches everyone who picked any district
  if (postAreas.some((a) => WHOLE.has(a))) {
    const all = (await kv('KEYS', `area:${city}:*`)) as string[]
    all.forEach((k) => keys.add(k))
  }
  const ids = (await kv('SUNION', ...keys)) as string[]
  return ids.map(Number)
}
