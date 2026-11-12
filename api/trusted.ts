/**
 * Довірені люди.
 *  GET    /api/trusted          my list (checks for «+» from people we wait on)
 *  POST   /api/trusted {handle} find them in Telegram and send the invite
 *  DELETE /api/trusted?handle=  remove
 */
import { json, readJson, readSession } from './_kv.js'
import { getProfile } from './_profile.js'
import { cleanHandle, inviteTrusted, publicTrusted, refreshTrusted, removeTrusted } from './_safety.js'
import { senderReady } from './_sender.js'

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const ready = Boolean(await senderReady())
  const list = ready ? await refreshTrusted(user.id) : []
  return json({ ok: true, ready, list: publicTrusted(list) })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  if (!(await senderReady())) return json({ ok: false, error: 'not_ready' }, 503)
  const body = await readJson<{ handle?: string; label?: string }>(request)
  const profile = await getProfile(user.id)
  try {
    const r = await inviteTrusted({ ...user, gender: profile?.gender }, body?.handle, body?.label)
    return r.ok ? json({ ok: true, list: publicTrusted(r.list) }) : json(r, 400)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const handle = cleanHandle(new URL(request.url).searchParams.get('handle'))
  if (handle) await removeTrusted(user.id, handle)
  return json({ ok: true })
}
