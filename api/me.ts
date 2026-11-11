/**
 *  GET  /api/me   the saved profile (if any) and an age hint from the Telegram birthday
 *  POST /api/me   save the profile {bio, areas, gender, age, notify, city}
 */
import { json, readJson, readSession, tg } from './_kv.js'
import { cleanProfile, getProfile, saveProfileServer } from './_profile.js'

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)

  const profile = await getProfile(user.id)
  let age: number | null = null
  if (!profile?.age) {
    const chat = await tg('getChat', { chat_id: user.id })
    const b = (chat.result as { birthdate?: { day: number; month: number; year?: number } } | undefined)?.birthdate
    if (chat.ok && b?.year) {
      const now = new Date()
      age = now.getFullYear() - b.year
      if (now.getMonth() + 1 < b.month || (now.getMonth() + 1 === b.month && now.getDate() < b.day)) age -= 1
      if (age < 16 || age > 99) age = null
    }
  }
  return json({ ok: true, profile, age })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<Record<string, unknown>>(request)
  if (!body) return json({ ok: false, error: 'bad_json' }, 400)
  const profile = cleanProfile(body)
  await saveProfileServer(user.id, profile)
  return json({ ok: true, profile })
}
