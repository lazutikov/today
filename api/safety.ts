/**
 * Безпечна зустріч.
 *  GET  /api/safety              my safety net (and the clock ticks)
 *  GET  /api/safety?t=<token>    the trusted person's view (no sign-in)
 *  GET  /api/safety?tick=1       tick every active safety net (asks «Все добре?», raises
 *                                alarms). Harmless any time: it only does what is due. Called by
 *                                the GitHub Actions schedule every 5 minutes.
 *  POST /api/safety {action:'start', …} | {action:'stop'}
 */
import { json, readJson, readSession } from './_kv.js'
import { getProfile } from './_profile.js'
import { getSafety, publicView, startSafety, stopSafety, tick, tickAll } from './_safety.js'

function mine(s: Awaited<ReturnType<typeof getSafety>>) {
  if (!s) return null
  return {
    matchId: s.matchId,
    guardians: s.guardians,
    checkAt: s.checkAt,
    until: s.until,
    fence: s.fence,
    live: s.live,
    lastAt: s.last?.at ?? null,
    asked: s.asked?.kind ?? null,
    alarm: s.alarm?.kind ?? null,
  }
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  if (q.get('tick')) return json({ ok: true, active: await tickAll() })
  const t = q.get('t')
  if (t) {
    const view = /^[A-Za-z0-9_-]{10,40}$/.test(t) ? await publicView(t) : null
    return view ? json({ ok: true, view }) : json({ ok: false, error: 'not_found' }, 404)
  }
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const s = await getSafety(user.id)
  if (s) await tick(s).catch(() => {})
  return json({ ok: true, ready: Boolean(process.env.TELEGRAM_BOT_TOKEN), safety: mine(await getSafety(user.id)) })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<Record<string, unknown>>(request)
  if (body?.action === 'stop') {
    await stopSafety(user.id, 'user')
    return json({ ok: true })
  }
  if (body?.action !== 'start') return json({ ok: false, error: 'bad_action' }, 400)
  const profile = await getProfile(user.id)
  const r = await startSafety(user, profile?.gender, body)
  return r.ok ? json({ ok: true, safety: mine(r.safety) }) : json(r, 400)
}
