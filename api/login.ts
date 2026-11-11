/**
 * Sign-in through the bot, no phone number:
 *  POST /api/login {code}       registers a one-time code made by the browser
 *  GET  /api/login?code=...     the browser polls until the bot has confirmed it
 * The bot webhook (/api/bot) confirms the code when the user taps Start.
 */
import { CODE_RE, CODE_TTL, json, kv, kvReady } from './_kv.js'

export async function POST(request: Request): Promise<Response> {
  if (!kvReady || !process.env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'not_configured' }, 503)
  let code = ''
  try {
    code = String(((await request.json()) as { code?: string }).code || '')
  } catch {
    /* handled below */
  }
  if (!CODE_RE.test(code)) return json({ ok: false, error: 'bad_code' }, 400)
  await kv('SET', `login:${code}`, 'pending', 'EX', CODE_TTL, 'NX')
  return json({ ok: true })
}

export async function GET(request: Request): Promise<Response> {
  if (!kvReady) return json({ ok: false, error: 'not_configured' }, 503)
  const code = new URL(request.url).searchParams.get('code') || ''
  if (!CODE_RE.test(code)) return json({ ok: false, error: 'bad_code' }, 400)
  const value = (await kv('GET', `login:${code}`)) as string | null
  if (!value) return json({ ok: false, error: 'expired' }, 410)
  if (value === 'pending') return json({ ok: false, pending: true })
  await kv('DEL', `login:${code}`)
  return json({ ok: true, user: JSON.parse(value) })
}
