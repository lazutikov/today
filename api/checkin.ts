/**
 * GET /api/checkin  run by Vercel Cron every morning (~10:00 Kyiv):
 * asks both people of each of yesterday's meetings whether it happened.
 * Protected by CRON_SECRET when set (Vercel sends it as a Bearer token).
 */
import { json } from './_kv.js'
import { askYesterday } from './_social.js'

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  const fromCron = (request.headers.get('user-agent') || '').includes('vercel-cron')
  if (secret ? auth !== `Bearer ${secret}` : !fromCron) return json({ ok: false }, 401)
  const asked = await askYesterday()
  return json({ ok: true, asked })
}
