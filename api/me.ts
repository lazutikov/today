/**
 * GET /api/me  hints for onboarding from the person's Telegram profile.
 * Age comes from the Telegram birthday, only when they set it with a year
 * and their privacy settings let the bot see it.
 */
import { json, readSession, tg } from './_kv.js'

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)

  const chat = await tg('getChat', { chat_id: user.id })
  const b = (chat.result as { birthdate?: { day: number; month: number; year?: number } } | undefined)?.birthdate
  let age: number | null = null
  if (chat.ok && b?.year) {
    const now = new Date()
    age = now.getFullYear() - b.year
    if (now.getMonth() + 1 < b.month || (now.getMonth() + 1 === b.month && now.getDate() < b.day)) age -= 1
    if (age < 16 || age > 99) age = null
  }
  return json({ ok: true, age })
}
