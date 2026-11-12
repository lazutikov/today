/**
 * Довірені люди, через бота.
 *  GET    /api/trusted          my list (status changes when they answer in the bot)
 *  POST   /api/trusted {label}  a new invite: returns the t.me link to share
 *  DELETE /api/trusted?handle=  remove
 */
import { json, kv, readJson, readSession } from './_kv.js'
import { cleanId, inviteLink, inviteTrusted, getTrusted, publicTrusted, removeTrusted } from './_safety.js'

const ready = Boolean(process.env.TELEGRAM_BOT_TOKEN)

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  return json({ ok: true, ready, list: await publicTrusted(await getTrusted(user.id)) })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<{ label?: string }>(request)
  // How the trusted person will see who invited them
  await kv('SET', `uname:${user.id}`, user.username ? `${user.first_name} (@${user.username})` : user.first_name, 'EX', 365 * 86400)
  const r = await inviteTrusted(user.id, body?.label)
  if (!r.ok) return json(r, 400)
  return json({ ok: true, list: await publicTrusted(r.list), link: await inviteLink(r.id) })
}

export async function DELETE(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const id = cleanId(new URL(request.url).searchParams.get('handle'))
  if (id) await removeTrusted(user.id, id)
  return json({ ok: true })
}
