/**
 * Verifies a Telegram Login payload (https://core.telegram.org/widgets/login#checking-authorization).
 * The bot token lives only in the Vercel env var TELEGRAM_BOT_TOKEN, never in the client.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { signSession } from './_kv.js'

const MAX_AGE_SECONDS = 24 * 60 * 60

export async function POST(request: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return json({ ok: false, error: 'not_configured' }, 500)

  let data: Record<string, unknown>
  try {
    data = await request.json()
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400)
  }

  if (typeof data.initData === 'string') return verifyMiniApp(data.initData, token)

  const { hash, ...fields } = data
  if (typeof hash !== 'string') return json({ ok: false, error: 'no_hash' }, 400)

  const checkString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== null)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = createHash('sha256').update(token).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ ok: false, error: 'bad_hash' }, 401)

  const age = Date.now() / 1000 - Number(fields.auth_date)
  if (!(age < MAX_AGE_SECONDS)) return json({ ok: false, error: 'expired' }, 401)

  const user = {
    id: Number(fields.id),
    first_name: String(fields.first_name ?? ''),
    username: (fields.username as string | undefined) ?? null,
    photo_url: (fields.photo_url as string | undefined) ?? null,
  }
  return json({ ok: true, user, session: signSession(user) })
}

/** https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
function verifyMiniApp(initData: string, token: string): Response {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return json({ ok: false, error: 'no_hash' }, 400)
  params.delete('hash')
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ ok: false, error: 'bad_hash' }, 401)

  const age = Date.now() / 1000 - Number(params.get('auth_date'))
  if (!(age < MAX_AGE_SECONDS)) return json({ ok: false, error: 'expired' }, 401)

  let u: Record<string, unknown> = {}
  try {
    u = JSON.parse(params.get('user') || '{}')
  } catch {
    return json({ ok: false, error: 'bad_user' }, 400)
  }
  const user = {
    id: Number(u.id),
    first_name: String(u.first_name ?? ''),
    username: (u.username as string | undefined) ?? null,
    photo_url: (u.photo_url as string | undefined) ?? null,
  }
  return json({ ok: true, user, session: signSession(user) })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
