/**
 *  GET    /api/posts?city=lviv   today's real posts (author hidden)
 *  POST   /api/posts             publish (replaces your previous post of the same kind)
 *  DELETE /api/posts?id=...      remove your post
 */
import { json, kvReady, readJson, readSession } from './_kv.js'
import { cleanPost, deletePost, listPosts, publicCard, savePost } from './_social.js'

export async function GET(request: Request): Promise<Response> {
  if (!kvReady) return json({ ok: false, error: 'not_configured' }, 503)
  const user = readSession(request)
  const city = new URL(request.url).searchParams.get('city') === 'warsaw' ? 'warsaw' : 'lviv'
  const posts = await listPosts(city)
  return json({ ok: true, posts: posts.map((p) => publicCard(p, user?.id ?? null)) })
}

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<Record<string, unknown>>(request)
  const post = body && cleanPost(body, user)
  if (!post) return json({ ok: false, error: 'bad_post' }, 400)
  await savePost(post)
  return json({ ok: true, post: publicCard(post, user.id) })
}

export async function DELETE(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const id = new URL(request.url).searchParams.get('id') || ''
  return json({ ok: await deletePost(id, user.id) })
}
