/**
 * Довірені люди, через бота.
 *  GET    /api/trusted          my list (status changes when they answer in the bot)
 *  POST   /api/trusted {handle} add by @nick or phone (shown as typed)
 *  DELETE /api/trusted?handle=  remove
 */
import { json, kv, readJson, readSession } from './_kv.js'
import { addTrustedHandle, cleanId, getTrusted, publicTrusted, removeTrusted } from './_safety.js'

const ready = Boolean(process.env.TELEGRAM_BOT_TOKEN)

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  return json({ ok: true, ready, list: await publicTrusted(await getTrusted(user.id)) })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<{ handle?: string }>(request)
  await kv('SET', `uname:${user.id}`, user.username ? `${user.first_name} (@${user.username})` : user.first_name, 'EX', 365 * 86400)
  const r = await addTrustedHandle(user.id, body?.handle)
  if (!r.ok) return json(r, 400)
  return json({ ok: true, list: await publicTrusted(r.list) })
}

export async function DELETE(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const id = cleanId(new URL(request.url).searchParams.get('handle'))
  if (id) await removeTrusted(user.id, id)
  return json({ ok: true })
}
