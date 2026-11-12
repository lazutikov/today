/**
 * Anonymous profile: shown on every post. Name and photo come from Telegram
 * and are revealed only after a match, so they are not stored here.
 */

export type Profile = {
  bio: string
  areas?: string[]
  gender?: 'Чоловік' | 'Жінка'
  age?: number
  /** Bot may message about new plans in my districts (on unless turned off) */
  notify?: boolean
  /** «Мої місця»: up to 2 rough points (~500 m), for pings and the feed */
  places?: { lat: number; lon: number; label: string }[]
  /** Pings for plans within this many km of my places */
  radius?: number
}

const KEY = 'today.profile'

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { bio: '', ...JSON.parse(raw) }
  } catch {
    /* storage unavailable: start empty */
  }
  return { bio: '' }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* keep it in memory only */
  }
}

/* ---------- Session (prototype only) ---------- */

const SESSION = 'today.signedIn'

export function isSignedIn(): boolean {
  try {
    return localStorage.getItem(SESSION) === '1'
  } catch {
    return false
  }
}

export function setSignedIn(on: boolean) {
  try {
    if (on) localStorage.setItem(SESSION, '1')
    else localStorage.removeItem(SESSION)
  } catch {
    /* prototype: ignore */
  }
}
