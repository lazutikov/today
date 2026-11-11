/**
 * Real posts and requests (invites to people, joins to events), shared by
 * /api/posts, /api/requests and the bot webhook.
 */
import { contactUrl, esc, kv, kyivDay, mention, secondsToKyivMidnight, tg, type SessionUser } from './_kv.js'

export const ANSWER_SECONDS = 5 * 60
const TAGS = ['Кава', 'Бар/Ресторан', 'Прогулянка', 'Кіно', 'Спорт', 'Ігри', 'Культура']

export type Post = {
  id: string
  kind: 'person' | 'event'
  headline: string
  bio: string
  time: string
  place: string
  venue?: string
  tags: string[]
  age: number
  gender?: 'Чоловік' | 'Жінка'
  capacity?: number
  taken?: number
  city: 'lviv' | 'warsaw'
  authorId: number
  authorName: string
  authorUsername: string | null
  createdAt: number
}

export type Req = {
  id: string
  type: 'invite' | 'join'
  postId: string
  postHeadline: string
  tag: string
  place: string
  time: string
  from: { id: number; first_name: string; username: string | null; gender?: string; age?: number; bio?: string }
  to: { id: number; first_name: string; username: string | null }
  status: 'pending' | 'yes' | 'no' | 'expired'
  reason?: string
  createdAt: number
  expiresAt: number
  authorMsgId?: number
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function cleanPost(input: Record<string, unknown>, user: SessionUser): Post | null {
  const kind = input.kind === 'event' ? 'event' : input.kind === 'person' ? 'person' : null
  const headline = str(input.headline, 200)
  const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => TAGS.includes(t as string)).slice(0, 4) : []
  if (!kind || !headline || tags.length === 0) return null
  const gender = input.gender === 'Чоловік' || input.gender === 'Жінка' ? input.gender : undefined
  const age = Number(input.age)
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    kind,
    headline,
    bio: str(input.bio, 300),
    time: str(input.time, 20),
    place: str(input.place, 160),
    venue: kind === 'event' ? str(input.venue, 120) || undefined : undefined,
    tags,
    age: Number.isFinite(age) && age > 0 && age < 100 ? Math.round(age) : 0,
    gender,
    capacity: kind === 'event' ? 4 : undefined,
    taken: kind === 'event' ? 1 : undefined,
    city: input.city === 'warsaw' ? 'warsaw' : 'lviv',
    authorId: user.id,
    authorName: user.first_name,
    authorUsername: user.username,
    createdAt: Date.now(),
  }
}

/** What the feed shows: no author identity before a match. */
export function publicCard(p: Post, viewerId: number | null) {
  return {
    id: p.id,
    kind: p.kind,
    headline: p.headline,
    bio: p.bio,
    time: p.time,
    place: p.place,
    venue: p.venue,
    tags: p.tags,
    name: '',
    age: p.age,
    gender: p.gender,
    taken: p.taken,
    capacity: p.capacity,
    mine: viewerId === p.authorId,
    real: true,
  }
}

const feedKey = (city: string) => `posts:${city}:${kyivDay()}`

export async function savePost(p: Post) {
  const ttl = secondsToKyivMidnight()
  // One live post per person and kind: a new one replaces the old.
  const prev = (await kv('GET', `mypost:${p.authorId}:${p.kind}`)) as string | null
  if (prev) await deletePost(prev, p.authorId)
  await kv('SET', `post:${p.id}`, JSON.stringify(p), 'EX', ttl)
  await kv('ZADD', feedKey(p.city), p.createdAt, p.id)
  await kv('EXPIRE', feedKey(p.city), ttl + 3600)
  await kv('SET', `mypost:${p.authorId}:${p.kind}`, p.id, 'EX', ttl)
}

export async function getPost(id: string): Promise<Post | null> {
  const raw = (await kv('GET', `post:${id}`)) as string | null
  return raw ? (JSON.parse(raw) as Post) : null
}

export async function deletePost(id: string, userId: number): Promise<boolean> {
  const p = await getPost(id)
  if (!p || p.authorId !== userId) return false
  await kv('DEL', `post:${id}`)
  await kv('ZREM', feedKey(p.city), id)
  return true
}

export async function listPosts(city: string): Promise<Post[]> {
  const ids = (await kv('ZRANGE', feedKey(city), 0, 99, 'REV')) as string[]
  if (!ids.length) return []
  const raws = (await kv('MGET', ...ids.map((i) => `post:${i}`))) as (string | null)[]
  return raws.filter((r): r is string => Boolean(r)).map((r) => JSON.parse(r) as Post)
}

/* ---------- Requests ---------- */

export async function getReq(id: string): Promise<Req | null> {
  const raw = (await kv('GET', `req:${id}`)) as string | null
  return raw ? (JSON.parse(raw) as Req) : null
}

async function putReq(r: Req) {
  await kv('SET', `req:${r.id}`, JSON.stringify(r), 'EX', 86400)
}

function who(r: Req) {
  const parts = [r.from.gender, r.from.age ? String(r.from.age) : ''].filter(Boolean).join(', ')
  return `${parts || 'Людина'}${r.from.bio ? `: «${esc(r.from.bio)}»` : ''}`
}

function requestText(r: Req) {
  const head =
    r.type === 'invite'
      ? `🔔 <b>Запрошення</b> на твій план «${esc(r.postHeadline)}»`
      : `🙋 <b>Хоче приєднатися</b> до «${esc(r.postHeadline)}»`
  return `${head}\n\n${who(r)}\n📍 ${esc(r.place)} · 🕐 ${esc(r.time)}\n\nУ тебе 5 хвилин на відповідь. Ім’я й контакт ви побачите після «Так».`
}

export async function createReq(
  user: SessionUser,
  post: Post,
  input: { place?: string; time?: string; gender?: string; age?: number; bio?: string },
): Promise<{ ok: true; req: Req } | { ok: false; error: string }> {
  if (post.authorId === user.id) return { ok: false, error: 'own_post' }
  if (post.kind === 'event' && (post.taken ?? 0) >= (post.capacity ?? 4)) return { ok: false, error: 'full' }
  const busy = await kv('SET', `outgoing:${user.id}`, 'x', 'EX', ANSWER_SECONDS, 'NX')
  if (busy === null) return { ok: false, error: 'busy' }

  const now = Date.now()
  const r: Req = {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    type: post.kind === 'event' ? 'join' : 'invite',
    postId: post.id,
    postHeadline: post.headline,
    tag: post.tags[0],
    place: post.kind === 'event' ? post.venue || post.place : str(input.place, 120) || post.place,
    time: post.kind === 'event' ? post.time : str(input.time, 20) || post.time,
    from: {
      id: user.id,
      first_name: user.first_name,
      username: user.username,
      gender: input.gender === 'Чоловік' || input.gender === 'Жінка' ? input.gender : undefined,
      age: Number(input.age) > 0 ? Math.round(Number(input.age)) : undefined,
      bio: str(input.bio, 300) || undefined,
    },
    to: { id: post.authorId, first_name: post.authorName, username: post.authorUsername },
    status: 'pending',
    createdAt: now,
    expiresAt: now + ANSWER_SECONDS * 1000,
  }
  const sent = await tg('sendMessage', {
    chat_id: post.authorId,
    text: requestText(r),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Так 👍', callback_data: `r:${r.id}:y` },
          { text: 'Ні', callback_data: `r:${r.id}:n` },
        ],
      ],
    },
  })
  if (sent.ok) r.authorMsgId = (sent.result as { message_id: number }).message_id
  await putReq(r)
  await kv('ZADD', `inbox:${post.authorId}`, r.expiresAt, r.id)
  await kv('EXPIRE', `inbox:${post.authorId}`, 86400)
  return { ok: true, req: r }
}

/** Marks a pending request expired once its 5 minutes are over. */
export async function settleExpiry(r: Req): Promise<Req> {
  if (r.status !== 'pending' || Date.now() < r.expiresAt) return r
  r.status = 'expired'
  await putReq(r)
  await kv('ZREM', `inbox:${r.to.id}`, r.id)
  await kv('DEL', `outgoing:${r.from.id}`)
  if (r.authorMsgId)
    await tg('editMessageText', {
      chat_id: r.to.id,
      message_id: r.authorMsgId,
      text: `${requestText(r)}\n\n⌛ Час на відповідь вийшов.`,
      parse_mode: 'HTML',
    })
  return r
}

export async function answerReq(
  id: string,
  userId: number,
  yes: boolean,
  reason?: string,
): Promise<{ ok: boolean; status?: Req['status']; error?: string }> {
  let r = await getReq(id)
  if (!r) return { ok: false, error: 'not_found' }
  if (r.to.id !== userId) return { ok: false, error: 'forbidden' }
  r = await settleExpiry(r)
  if (r.status !== 'pending') return { ok: false, status: r.status, error: 'already' }

  r.status = yes ? 'yes' : 'no'
  if (reason) r.reason = str(reason, 60)
  await putReq(r)
  await kv('ZREM', `inbox:${r.to.id}`, r.id)
  await kv('DEL', `outgoing:${r.from.id}`)

  if (yes && r.type === 'join') {
    const p = await getPost(r.postId)
    if (p) {
      p.taken = (p.taken ?? 1) + 1
      await kv('SET', `post:${p.id}`, JSON.stringify(p), 'KEEPTTL')
    }
  }

  const where = `📍 ${esc(r.place)} · 🕐 ${esc(r.time)}`
  if (r.authorMsgId)
    await tg('editMessageText', {
      chat_id: r.to.id,
      message_id: r.authorMsgId,
      text: `${requestText(r)}\n\n${yes ? '✅ Ти погодився.' : '✖️ Ти відмовив.'}`,
      parse_mode: 'HTML',
    })
  if (yes) {
    await tg('sendMessage', {
      chat_id: r.from.id,
      parse_mode: 'HTML',
      text: `🎉 <b>Є матч!</b> «${esc(r.postHeadline)}»\n\nЦе ${mention(r.to)}.\n${where}\n\nНапиши, щоб домовитися про деталі.`,
      // A button to tg://user?id= can be refused by privacy settings; the mention in the text always works.
      reply_markup: r.to.username ? { inline_keyboard: [[{ text: `Написати ${r.to.first_name}`, url: contactUrl(r.to) }]] } : undefined,
    })
    await tg('sendMessage', {
      chat_id: r.to.id,
      parse_mode: 'HTML',
      text: `🎉 <b>Є матч!</b> З тобою ${mention(r.from)}.\n${where}\n\nНапиши, щоб домовитися про деталі.`,
      reply_markup: r.from.username
        ? { inline_keyboard: [[{ text: `Написати ${r.from.first_name}`, url: contactUrl(r.from) }]] }
        : undefined,
    })
  } else {
    await tg('sendMessage', {
      chat_id: r.from.id,
      text: `Цього разу не вийшло з «${r.postHeadline}». Таке буває. У стрічці є ще люди, вільні сьогодні.`,
    })
  }
  return { ok: true, status: r.status }
}

/** What the requester's app sees while waiting. */
export function reqStatusView(r: Req) {
  return {
    id: r.id,
    status: r.status,
    expiresAt: r.expiresAt,
    match:
      r.status === 'yes'
        ? { name: r.to.first_name, username: r.to.username, contact: contactUrl(r.to), place: r.place, time: r.time, tag: r.tag }
        : null,
  }
}

/** What the author's app sees in its inbox. */
export function inboxView(r: Req) {
  return {
    id: r.id,
    type: r.type,
    post: r.postHeadline,
    tag: r.tag,
    place: r.place,
    time: r.time,
    from: { gender: r.from.gender ?? null, age: r.from.age ?? 0, bio: r.from.bio ?? '' },
    expiresAt: r.expiresAt,
  }
}

export function matchViewForAuthor(r: Req) {
  return { name: r.from.first_name, username: r.from.username, contact: contactUrl(r.from), place: r.place, time: r.time, tag: r.tag }
}
