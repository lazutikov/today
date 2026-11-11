/**
 * Open once in a browser: points the bot's webhook at this deployment.
 * Safe to repeat; it only ever registers this site's own /api/bot.
 */
import { json } from './_kv'
import { webhookSecret } from './bot'

export async function GET(request: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return json({ ok: false, error: 'no TELEGRAM_BOT_TOKEN' }, 500)
  const url = `https://${request.headers.get('host')}/api/bot`
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, secret_token: webhookSecret(token), allowed_updates: ['message'], drop_pending_updates: true }),
  })
  const tg = (await res.json()) as { ok: boolean; description?: string }
  return json({ ok: tg.ok, webhook: url, telegram: tg.description ?? null, storage: Boolean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) })
}
