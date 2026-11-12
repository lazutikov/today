/**
 * Real posts and requests (invites to people, joins to events), shared by
 * /api/posts, /api/requests and the bot webhook.
 */
import {
  cleanCity,
  isBlocked,
  ownerId,
  phCapture,
  contactUrl,
  esc,
  kv,
  kyivDay,
  kyivMinutes,
  mention,
  secondsToKyivMidnight,
  signPhoto,
  tg,
  type SessionUser,
} from './_kv.js'
import { audienceFor } from './_profile.js'

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
  /** Districts picked by the author (for "new plan near you") */
  areas?: string[]
  /** Exact venue from the map picker */
  venueAddress?: string
  lat?: number
  lon?: number
  age: number
  gender?: 'Чоловік' | 'Жінка'
  capacity?: number
  taken?: number
  /** 'lviv', 'warsaw' or any city's lowercased local name */
  city: string
  authorId: number
  authorName: string
  authorUsername: string | null
  createdAt: number
  /** A free-time post closes after its first match */
  matched?: boolean
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
  status: 'pending' | 'yes' | 'no' | 'expired' | 'cancelled'
  /** Who cancelled a confirmed meeting, and whether they flagged it as uncomfortable */
  cancelledBy?: number
  reported?: boolean
  /** Post author's age, for the requester's match screen */
  toAge?: number
  /** Where to meet, if picked on the map */
  lat?: number
  lon?: number
  address?: string
  reason?: string
  createdAt: number
  expiresAt: number
  authorMsgId?: number
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A real coordinate or undefined (map picker can also return just a name) */
function coords(input: Record<string, unknown>): { lat?: number; lon?: number } {
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 }
    : {}
}

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
    areas: Array.isArray(input.areas)
      ? input.areas.filter((a): a is string => typeof a === 'string' && a.length <= 40).slice(0, 3)
      : [],
    ...(kind === 'event' ? { venueAddress: str(input.venueAddress, 160) || undefined, ...coords(input) } : {}),
    age: Number.isFinite(age) && age > 0 && age < 100 ? Math.round(age) : 0,
    gender,
    // Author + 1..6 people they are looking for
    capacity: kind === 'event' ? Math.min(7, Math.max(2, Math.round(Number(input.capacity)) || 2)) : undefined,
    taken: kind === 'event' ? 1 : undefined,
    city: cleanCity(input.city),
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
    areas: p.areas ?? [],
    venueAddress: p.venueAddress,
    lat: p.lat,
    lon: p.lon,
    name: '',
    age: p.age,
    gender: p.gender,
    taken: p.taken,
    capacity: p.capacity,
    mine: viewerId === p.authorId,
    matched: Boolean(p.matched),
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
  const blocked = new Set(((await kv('SMEMBERS', 'blocked')) as string[]).map(Number))
  return raws
    .filter((r): r is string => Boolean(r))
    .map((r) => JSON.parse(r) as Post)
    .filter((p) => !blocked.has(p.authorId))
}

/* ---------- Morning check-in: did yesterday's meetings happen? ---------- */

export type Outcome = 'met' | 'noshow' | 'off'

export async function askYesterday(): Promise<number> {
  const day = kyivDay(1)
  const ids = (await kv('SMEMBERS', `meetings:${day}`)) as string[]
  let asked = 0
  for (const id of ids) {
    const r = await getReq(id)
    if (!r || r.status !== 'yes') continue
    if ((await kv('SET', `checkin:${id}`, '1', 'EX', 7 * 86400, 'NX')) === null) continue // already asked
    for (const [me, other] of [
      [r.from, r.to],
      [r.to, r.from],
    ] as const) {
      const res = await tg('sendMessage', {
        chat_id: me.id,
        parse_mode: 'HTML',
        text: `Доброго ранку! Вчора о ${esc(r.time)} була зустріч з ${mention(other)}: «${esc(r.postHeadline)}».\n\nЯк пройшло?`,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Зустрілися 👍', callback_data: `m:${id}:met` }],
            [
              { text: 'Не прийшли', callback_data: `m:${id}:noshow` },
              { text: 'Скасували', callback_data: `m:${id}:off` },
            ],
          ],
        },
      })
      if (res.ok) asked++
    }
  }
  return asked
}

export async function saveOutcome(id: string, userId: number, outcome: Outcome): Promise<boolean> {
  const r = await getReq(id)
  if (!r || (r.from.id !== userId && r.to.id !== userId)) return false
  await kv('SET', `outcome:${id}:${userId}`, outcome, 'EX', 30 * 86400)
  await phCapture('meeting_outcome', String(userId), { outcome, tag: r.tag, type: r.type, req: id })
  return true
}

/** "Delete my data": profile, own posts, notifications, photo link */
export async function deleteUser(userId: number) {
  const { getProfile } = await import('./_profile.js')
  const p = await getProfile(userId)
  for (const a of p?.areas ?? []) await kv('SREM', `area:${p!.city}:${a}`, userId)
  for (const kind of ['person', 'event']) {
    const postId = (await kv('GET', `mypost:${userId}:${kind}`)) as string | null
    if (postId) await deletePost(postId, userId)
    await kv('DEL', `mypost:${userId}:${kind}`)
  }
  await kv('DEL', `profile:${userId}`, `notif:${userId}`, `notifseen:${userId}`, `tgphoto:${userId}`, `matches:${userId}`, `inbox:${userId}`)
}

/* ---------- Notifications: everything the bot says, also kept for the app ---------- */

export type Notif = {
  id: string
  type: 'request' | 'match' | 'declined' | 'expired' | 'cancelled'
  at: number
  reqId: string
  postId: string
  post: string
  tag: string
  place: string
  time: string
  /** The other person: hidden identity before a match, name after */
  who: string
  /** For requests: what kind (invite to my free time / join my plan) */
  kind?: 'invite' | 'join'
  expiresAt?: number
}

export async function notify(userId: number, n: Omit<Notif, 'id' | 'at'>) {
  const item: Notif = { ...n, id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }
  await kv('LPUSH', `notif:${userId}`, JSON.stringify(item))
  await kv('LTRIM', `notif:${userId}`, 0, 99)
  await kv('EXPIRE', `notif:${userId}`, 2 * 86400)
}

export async function listNotifs(userId: number) {
  const raws = (await kv('LRANGE', `notif:${userId}`, 0, 99)) as string[]
  const seen = Number((await kv('GET', `notifseen:${userId}`)) || 0)
  return { items: raws.map((r) => JSON.parse(r) as Notif), seen }
}

export async function markNotifsSeen(userId: number) {
  await kv('SET', `notifseen:${userId}`, Date.now(), 'EX', 7 * 86400)
}

const base = (r: Req) => ({ reqId: r.id, postId: r.postId, post: r.postHeadline, tag: r.tag, place: r.place, time: r.time })

/* ---------- Double booking ---------- */

/** Meetings closer than this (start to start) can't both happen. */
export const CLASH_MINUTES = 90

const startMin = (t: string) => {
  const m = /(\d{1,2}):(\d{2})/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Another confirmed meeting of this person at about the same time (a different plan). */
export async function clashFor(userId: number, time: string, postId: string): Promise<Req | null> {
  const at = startMin(time)
  if (at === null) return null
  const ids = (await kv('ZRANGE', `matches:${userId}`, 0, -1)) as string[]
  for (const id of ids) {
    const r = await getReq(id)
    if (!r || r.status !== 'yes' || r.postId === postId) continue
    const other = startMin(r.time)
    if (other !== null && Math.abs(other - at) < CLASH_MINUTES) return r
  }
  return null
}

/** "о 19:30 з Андрієм" for the person who would double-book */
export function clashText(r: Req, viewerId: number) {
  const other = r.from.id === viewerId ? r.to : r.from
  return `У тебе вже є зустріч о ${r.time}: ${other.first_name}, «${r.postHeadline}». Скасуй її або обери інший час.`
}

/* ---------- Requests ---------- */

export async function getReq(id: string): Promise<Req | null> {
  const raw = (await kv('GET', `req:${id}`)) as string | null
  return raw ? (JSON.parse(raw) as Req) : null
}

async function putReq(r: Req) {
  await kv('SET', `req:${r.id}`, JSON.stringify(r), 'EX', 86400)
}

function plainWho(r: Req) {
  const parts = [r.from.gender, r.from.age ? String(r.from.age) : ''].filter(Boolean).join(', ')
  return `${parts || 'Стать не вказана'}${r.from.bio ? `: «${r.from.bio}»` : ''}`
}

function who(r: Req) {
  const parts = [r.from.gender, r.from.age ? String(r.from.age) : ''].filter(Boolean).join(', ')
  return `${parts || 'Стать не вказана'}${r.from.bio ? `: «${esc(r.from.bio)}»` : ''}`
}

/** "вулиця Городоцька, 25, Галицький район, Львів" → "вул. Городоцька, 25" */
export function shortAddr(address?: string): string {
  if (!address) return ''
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/район|львів|lviv|україна|ukraine|середмістя/i.test(p))
  const s = (parts[1] && /^\d/.test(parts[1]) ? `${parts[0]}, ${parts[1]}` : parts[0]) ?? ''
  return s.replace(/^вулиця /i, 'вул. ').replace(/^площа /i, 'пл. ').replace(/^проспект /i, 'просп. ')
}

/** 📍 Львівська копальня кави · пл. Ринок, 10 / 🕐 19:30 */
function whereWhen(place: string, address: string | undefined, time: string) {
  const a = shortAddr(address)
  return `📍 ${esc(place)}${a ? ` · ${esc(a)}` : ''}\n🕐 ${esc(time)}`
}

function requestText(r: Req) {
  const head =
    r.type === 'invite'
      ? `🔔 <b>Запрошення</b> на твій план «${esc(r.postHeadline)}»`
      : `🙋 <b>Хоче приєднатися</b> до «${esc(r.postHeadline)}»`
  return `${head}\n\n${who(r)}\n${whereWhen(r.place, r.address, r.time)}\n\nУ тебе 5 хвилин на відповідь. Ім’я й контакт ви побачите після «Так».`
}

export async function createReq(
  user: SessionUser,
  post: Post,
  input: { place?: string; time?: string; gender?: string; age?: number; bio?: string; lat?: number; lon?: number; address?: string },
): Promise<{ ok: true; req: Req } | { ok: false; error: string; message?: string }> {
  if (post.authorId === user.id) return { ok: false, error: 'own_post' }
  if (await isBlocked(user.id)) return { ok: false, error: 'blocked' }
  if (post.matched) return { ok: false, error: 'taken' }
  if (post.kind === 'event' && (post.taken ?? 0) >= (post.capacity ?? 2)) return { ok: false, error: 'full' }
  const wantTime = post.kind === 'event' ? post.time : str(input.time, 20) || post.time
  const mine = await clashFor(user.id, wantTime, post.id)
  if (mine) return { ok: false, error: 'conflict', message: clashText(mine, user.id) }
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
    toAge: post.age || undefined,
    ...(post.kind === 'event'
      ? { lat: post.lat, lon: post.lon, address: post.venueAddress }
      : { ...coords(input as Record<string, unknown>), address: str(input.address, 160) || undefined }),
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
  await notify(post.authorId, { ...base(r), type: 'request', who: plainWho(r), kind: r.type, expiresAt: r.expiresAt })
  await kv('ZADD', `inbox:${post.authorId}`, r.expiresAt, r.id)
  await kv('EXPIRE', `inbox:${post.authorId}`, 86400)
  return { ok: true, req: r }
}

/** Marks a pending request expired once its 5 minutes are over. */
export async function settleExpiry(r: Req): Promise<Req> {
  if (r.status !== 'pending' || Date.now() < r.expiresAt) return r
  r.status = 'expired'
  await putReq(r)
  await notify(r.from.id, { ...base(r), type: 'expired', who: '' })
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
): Promise<{ ok: boolean; status?: Req['status']; error?: string; message?: string }> {
  let r = await getReq(id)
  if (!r) return { ok: false, error: 'not_found' }
  if (r.to.id !== userId) return { ok: false, error: 'forbidden' }
  r = await settleExpiry(r)
  if (r.status !== 'pending') return { ok: false, status: r.status, error: 'already' }

  if (yes) {
    const authorBusy = await clashFor(r.to.id, r.time, r.postId)
    if (authorBusy) return { ok: false, error: 'conflict', message: clashText(authorBusy, r.to.id) }
    const requesterBusy = await clashFor(r.from.id, r.time, r.postId)
    if (requesterBusy) {
      await answerReq(id, userId, false, 'зайнято')
      return { ok: false, error: 'they_busy', message: 'Ця людина вже має зустріч на цей час. Запит закрито.' }
    }
  }

  r.status = yes ? 'yes' : 'no'
  if (reason) r.reason = str(reason, 60)
  await putReq(r)
  await kv('ZREM', `inbox:${r.to.id}`, r.id)
  await kv('DEL', `outgoing:${r.from.id}`)

  if (yes) {
    // Both sides keep today's meetings, so the app shows them after a reload or a "Так" tapped in the bot.
    await kv('SADD', `meetings:${kyivDay()}`, r.id)
    await kv('EXPIRE', `meetings:${kyivDay()}`, 3 * 86400)
    const ttl = secondsToKyivMidnight() + 3 * 3600
    for (const uid of [r.from.id, r.to.id]) {
      await kv('ZADD', `matches:${uid}`, r.createdAt, r.id)
      await kv('EXPIRE', `matches:${uid}`, ttl)
    }
    const p = await getPost(r.postId)
    if (p) {
      if (r.type === 'join') p.taken = (p.taken ?? 1) + 1
      else p.matched = true
      await kv('SET', `post:${p.id}`, JSON.stringify(p), 'KEEPTTL')
    }
  }

  if (yes) {
    await notify(r.from.id, { ...base(r), type: 'match', who: r.to.first_name })
    await notify(r.to.id, { ...base(r), type: 'match', who: r.from.first_name })
  } else {
    await notify(r.from.id, { ...base(r), type: 'declined', who: '' })
  }

  const where = whereWhen(r.place, r.address, r.time)
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
    if (r.lat !== undefined && r.lon !== undefined) {
      for (const chat_id of [r.from.id, r.to.id])
        await tg('sendVenue', { chat_id, latitude: r.lat, longitude: r.lon, title: r.place, address: r.address || `${r.time}` })
    }
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
        ? {
            name: r.to.first_name,
            username: r.to.username,
            contact: contactUrl(r.to),
            photo: signPhoto(r.to.id, r.from.id),
            place: r.place,
            address: shortAddr(r.address),
            time: r.time,
            tag: r.tag,
            lat: r.lat,
            lon: r.lon,
          }
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
    address: shortAddr(r.address),
    time: r.time,
    from: { gender: r.from.gender ?? null, age: r.from.age ?? 0, bio: r.from.bio ?? '' },
    expiresAt: r.expiresAt,
  }
}

export function matchViewForAuthor(r: Req) {
  return {
    name: r.from.first_name,
    username: r.from.username,
    contact: contactUrl(r.from),
    photo: signPhoto(r.from.id, r.to.id),
    place: r.place,
    address: shortAddr(r.address),
    time: r.time,
    tag: r.tag,
    lat: r.lat,
    lon: r.lon,
  }
}

/* ---------- Today's confirmed meetings ---------- */

/** One meeting as the viewer sees it: the other person, where and when. */
export function meetingView(r: Req, viewerId: number) {
  const iAmAuthor = r.to.id === viewerId
  const other = iAmAuthor ? r.from : r.to
  return {
    id: r.id,
    name: other.first_name,
    age: (iAmAuthor ? r.from.age : r.toAge) ?? 0,
    contact: contactUrl(other),
    photo: signPhoto(other.id, viewerId),
    tag: r.tag,
    place: r.place,
    address: shortAddr(r.address),
    time: r.time,
    lat: r.lat,
    lon: r.lon,
    post: r.postHeadline,
    source: iAmAuthor ? 'incoming' : r.type === 'join' ? 'event' : 'invite',
    acceptedAt: r.createdAt,
    /** The other person called it off */
    cancelled: r.status === 'cancelled',
  }
}

export async function listMeetings(userId: number) {
  const ids = (await kv('ZRANGE', `matches:${userId}`, 0, -1, 'REV')) as string[]
  const reqs = await Promise.all(ids.map((id) => getReq(id)))
  // Active meetings, plus ones the *other* person cancelled (so this person learns about it in the app).
  return reqs
    .filter((r): r is Req => Boolean(r && (r.status === 'yes' || (r.status === 'cancelled' && r.cancelledBy !== userId))))
    .map((r) => meetingView(r, userId))
}

/** Cancels a confirmed meeting from either side and tells the other person. */
export async function cancelMeeting(id: string, userId: number, uncomfortable: boolean) {
  const r = await getReq(id)
  if (!r || (r.from.id !== userId && r.to.id !== userId)) return { ok: false, error: 'not_found' }
  if (r.status !== 'yes') return { ok: false, error: 'not_active' }
  r.status = 'cancelled'
  r.cancelledBy = userId
  r.reported = uncomfortable
  await putReq(r)
  if (uncomfortable) {
    await kv('LPUSH', 'reports', JSON.stringify({ req: r.id, by: userId, at: Date.now() }))
    const reporter = r.from.id === userId ? r.from : r.to
    const other = r.from.id === userId ? r.to : r.from
    const owner = await ownerId()
    if (owner)
      await tg('sendMessage', {
        chat_id: owner,
        parse_mode: 'HTML',
        text:
          `⚠️ <b>Скарга «Мені некомфортно»</b>\n\n` +
          `Від: ${mention(reporter)}\nНа: ${mention(other)}\n` +
          `План: «${esc(r.postHeadline)}»\n${whereWhen(r.place, r.address, r.time)}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: `Заблокувати ${other.first_name}`, callback_data: `block:${other.id}` }],
            [{ text: 'Залишити', callback_data: 'noop' }],
          ],
        },
      })
    await phCapture('report', String(userId), { req: r.id })
  }

  const p = await getPost(r.postId)
  if (p) {
    if (r.type === 'join') p.taken = Math.max(1, (p.taken ?? 2) - 1)
    else p.matched = false
    await kv('SET', `post:${p.id}`, JSON.stringify(p), 'KEEPTTL')
  }

  const me = r.from.id === userId ? r.from : r.to
  const other = r.from.id === userId ? r.to : r.from
  await notify(other.id, { ...base(r), type: 'cancelled', who: me.first_name })
  await tg('sendMessage', {
    chat_id: other.id,
    text: `${me.first_name} скасував(ла) зустріч «${r.postHeadline}» (${r.place}, ${r.time}). Шкода. У стрічці є ще люди, вільні сьогодні.`,
  })
  return { ok: true }
}

/* ---------- "New plan near you" pings from the bot ---------- */

export const PINGS_PER_DAY = 2
const QUIET_FROM = 23 * 60
const QUIET_TO = 9 * 60

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** A post is still worth pinging about until its (end) time has passed. */
export function stillAhead(time: string, now = kyivMinutes()): boolean {
  const parts = time.split('-').map((x) => toMin(x))
  const end = parts[parts.length - 1] ?? parts[0]
  return end === null || end === undefined ? true : end > now
}

export function quietNow(now = kyivMinutes()): boolean {
  return now >= QUIET_FROM || now < QUIET_TO
}

/** Tells people in the post's districts about it. Returns how many were messaged. */
export async function pingNearby(p: Post, site: string): Promise<number> {
  if (quietNow() || !stillAhead(p.time)) return 0
  const audience = (await audienceFor(p.city, p.areas ?? [])).filter((id) => id !== p.authorId)
  const who = [p.gender ?? 'Стать не вказана', p.age ? String(p.age) : ''].filter(Boolean).join(', ')
  const head = p.kind === 'person' ? '🙋 <b>Хтось вільний сьогодні поруч</b>' : '🎯 <b>Новий план поруч</b>'
  const where =
    p.kind === 'event' && p.venue
      ? whereWhen(p.venue, [p.areas?.[0], shortAddr(p.venueAddress)].filter(Boolean).join(', '), p.time)
      : whereWhen(p.place, undefined, p.time)
  const text = `${head}\n\n«${esc(p.headline)}»\n${esc(who)}${p.bio ? `: «${esc(p.bio)}»` : ''}\n${where}`
  const day = kyivDay()
  let sent = 0
  await Promise.all(
    audience.map(async (uid) => {
      const n = Number(await kv('INCR', `pings:${uid}:${day}`))
      if (n === 1) await kv('EXPIRE', `pings:${uid}:${day}`, 2 * 86400)
      if (n > PINGS_PER_DAY) return
      const r = await tg('sendMessage', {
        chat_id: uid,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Подивитися', web_app: { url: `${site}/app?post=${p.id}` } }],
            [{ text: 'Не надсилати такі', callback_data: 'mute' }],
          ],
        },
      })
      if (r.ok) sent++
    }),
  )
  return sent
}
