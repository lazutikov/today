/**
 * Tiny Upstash Redis client over REST (no dependency). Vercel's Upstash
 * integration sets KV_REST_API_* or UPSTASH_REDIS_REST_* depending on version.
 */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

export const kvReady = Boolean(URL_ && TOKEN)

export async function kv(...command: (string | number)[]): Promise<unknown> {
  if (!kvReady) throw new Error('kv_not_configured')
  const res = await fetch(URL_ as string, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  const body = (await res.json()) as { result?: unknown; error?: string }
  if (body.error) throw new Error(body.error)
  return body.result
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Login codes: 32 hex chars, made in the browser. */
export const CODE_RE = /^[a-f0-9]{32}$/
export const CODE_TTL = 10 * 60
