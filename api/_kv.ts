import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Tiny Upstash Redis client over REST (no dependency). Vercel's Upstash
 * integration sets KV_REST_API_* or UPSTASH_REDIS_REST_* depending on version.
 */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const kvReady = Boolean(URL_ && TOKEN)

export async function kv(...command: (string | number)[]): Promise<unknown> {
  if (!kvReady) throw new Error('kv_not_configured')
  const res = await fetch(URL_ as string, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  const body = (await res.json()) as { result?: unknown; error?: string }
  if (body.error) throw new Error(body.error)
  return body.result
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Login codes: 32 hex chars, made in the browser. */
export const CODE_RE = /^[a-f0-9]{32}$/
export const CODE_TTL = 10 * 60

/* ---------- Sessions: signed with a key derived from the bot token ---------- */

export type SessionUser = { id: number; first_name: string; username: string | null }

const SESSION_DAYS = 30

function sessionKey() {
  return createHash('sha256').update(`today-session:${process.env.TELEGRAM_BOT_TOKEN}`).digest()
}

export function signSession(u: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({ id: u.id, n: u.first_name, u: u.username, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 }),
  ).toString('base64url')
  const sig = createHmac('sha256', sessionKey()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function readSession(request: Request): SessionUser | null {
  const raw = (request.headers.get('authorization') || '').replace(/^Bearer /, '')
  const [payload, sig] = raw.split('.')
  if (!payload || !sig || !process.env.TELEGRAM_BOT_TOKEN) return null
  const expected = createHmac('sha256', sessionKey()).update(payload).digest()
  const given = Buffer.from(sig, 'base64url')
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { id: number; n: string; u: string | null; exp: number }
    if (d.exp < Date.now() / 1000) return null
    return { id: d.id, first_name: d.n, username: d.u }
  } catch {
    return null
  }
}

/* ---------- Kyiv day: posts live until local midnight ---------- */

export function kyivDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
}

/** Minutes since local midnight in Kyiv (0..1439). */
export function kyivMinutes(): number {
  return Math.floor((86400 - secondsToKyivMidnight()) / 60)
}

export function secondsToKyivMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0)
  return Math.max(60, 86400 - (get('hour') * 3600 + get('minute') * 60 + get('second')))
}

/* ---------- Telegram Bot API ---------- */

export async function tg(method: string, body: unknown): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as { ok: boolean }
  } catch {
    return { ok: false, description: 'network' }
  }
}

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Clickable name that opens the person's Telegram, works without a username too. */
export function mention(u: { id: number; first_name: string; username?: string | null }) {
  return `<a href="tg://user?id=${u.id}">${esc(u.first_name || 'Людина')}</a>${u.username ? ` (@${esc(u.username)})` : ''}`
}

export function contactUrl(u: { id: number; username?: string | null }) {
  return u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.id}`
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

/* ---------- Profile photos: only for the two people in a match ---------- */

export function signPhoto(userId: number, viewerId: number): string {
  const exp = Math.floor(Date.now() / 1000) + 86400
  const sig = createHmac('sha256', sessionKey()).update(`photo:${userId}:${viewerId}:${exp}`).digest('base64url').slice(0, 32)
  return `/api/photo?u=${userId}&v=${viewerId}&e=${exp}&s=${sig}`
}

export function checkPhoto(u: string, v: string, e: string, s: string): boolean {
  if (Number(e) < Date.now() / 1000) return false
  const sig = createHmac('sha256', sessionKey()).update(`photo:${u}:${v}:${e}`).digest('base64url').slice(0, 32)
  return sig.length === s.length && timingSafeEqual(Buffer.from(sig), Buffer.from(s))
}
