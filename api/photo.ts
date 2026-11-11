/**
 * GET /api/photo?u=&v=&e=&s=  a matched person's Telegram profile photo.
 * Telegram file links contain the bot token, so the image is fetched here and
 * passed through; the signed link is issued only inside a match.
 */
import { checkPhoto, tg } from './_kv.js'

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  const [u, v, e, s] = ['u', 'v', 'e', 's'].map((k) => q.get(k) || '')
  if (!checkPhoto(u, v, e, s)) return new Response('forbidden', { status: 403 })

  const photos = await tg('getUserProfilePhotos', { user_id: Number(u), limit: 1 })
  const sizes = (photos.result as { photos?: { file_id: string; width: number }[][] } | undefined)?.photos?.[0]
  if (!photos.ok || !sizes?.length) return new Response('no photo', { status: 404 })
  const best = sizes.find((p) => p.width >= 320) ?? sizes[sizes.length - 1]

  const file = await tg('getFile', { file_id: best.file_id })
  const path = (file.result as { file_path?: string } | undefined)?.file_path
  if (!file.ok || !path) return new Response('no file', { status: 404 })
  const img = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`)
  if (!img.ok) return new Response('fetch failed', { status: 502 })
  return new Response(await img.arrayBuffer(), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' },
  })
}
