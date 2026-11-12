/**
 * Безпечна зустріч on the server.
 *
 * trusted:{uid}   people invited by a link to the bot (t.me/<bot>?start=tr_<id>) who pressed «Так».
 *                 The bot writes to them: they started it, so it may.
 * tinv:{id}       → owner uid, for the invite link
 * gidx:{chatId}   → "uid:id" entries, so a trusted person can say /stop
 * safety:{uid}    the safety net for one meeting: who knows, when to ask, the venue,
 *                 the last position from the bot's live location
 * safetok:{token} → uid, for the trusted person's page /safe?t=…
 * safety:active   set of uids to tick
 *
 * Every alarm asks the person first («Все добре?» in the bot) and only then
 * writes to the trusted people. Nothing is sent before they agreed.
 */
import { randomBytes } from 'node:crypto'
import { esc, json, km, kv, phCapture, tg } from './_kv.js'
import { findPerson, senderReady, sendText, withSender, type Peer } from './_sender.js'

export type Trusted = {
  /** Invite id, also the key in the client */
  handle: string
  /** How the owner calls them: «Мама» */
  label: string
  status: 'wait' | 'ok' | 'no'
  /** Filled when they open the invite and agree */
  chatId?: number
  name?: string
  username?: string
  /** Resolved Telegram user, to write from the sender account */
  peer?: Peer
  invitedAt: number // seconds
}

export type SafetyState = {
  uid: number
  name: string // the person's first name, as the trusted people know it
  gender?: 'Чоловік' | 'Жінка'
  token: string
  matchId: string
  guardians: string[] // invite ids
  time: string // meeting time "19:00"
  place: string
  address?: string
  withName?: string
  withAge?: number
  venue?: { lat: number; lon: number }
  checkAt: number // ms
  until: number // ms
  fence: boolean
  /** Safety mode settings: how far is "away", how long to wait for an answer */
  fenceKm?: number
  answerMin?: number
  live: boolean
  last?: { lat: number; lon: number; at: number }
  outsideSince?: number
  checkDone?: boolean
  /** A question the bot asked and waits for: no answer by `deadline` → alarm */
  asked?: { kind: 'check' | 'fence' | 'lost'; at: number; deadline: number; msgId?: number }
  alarm?: { kind: 'check' | 'fence' | 'lost'; at: number }
  startedAt: number
}

const SITE = process.env.SITE_URL || 'https://today-pvfu.vercel.app'
const MIN = 60_000
const ANSWER = { check: 10 * MIN, fence: 5 * MIN, lost: 10 * MIN }
const SILENCE = 30 * MIN // no position for this long → ask
const FENCE_KM = 1

export const cleanId = (raw: unknown): string | null =>
  typeof raw === 'string' && /^[A-Za-z0-9_-]{6,24}$/.test(raw) ? raw : null

/* ---------- trusted people ---------- */

export async function getTrusted(uid: number): Promise<Trusted[]> {
  const raw = (await kv('GET', `trusted:${uid}`)) as string | null
  return raw ? (JSON.parse(raw) as Trusted[]) : []
}
async function saveTrusted(uid: number, list: Trusted[]) {
  await kv('SET', `trusted:${uid}`, JSON.stringify(list), 'EX', 365 * 86400)
}

let botName: string | null = process.env.TELEGRAM_BOT_NAME || process.env.VITE_TG_BOT_NAME || null
async function getBotName() {
  if (botName) return botName
  const r = await tg('getMe', {})
  botName = (r.result as { username?: string } | undefined)?.username ?? null
  return botName
}
export const inviteLink = async (id: string) => `https://t.me/${await getBotName()}?start=tr_${id}`

export async function publicTrusted(l: Trusted[]) {
  return Promise.all(
    l.map(async (t) => ({
      handle: t.handle,
      label: t.label,
      name: t.status === 'ok' ? [t.name, t.username ? '@' + t.username : ''].filter(Boolean).join(' · ') : '',
      status: t.status,
      link: t.status === 'wait' ? await inviteLink(t.handle) : undefined,
    })),
  )
}

const verb = (g: SafetyState['gender'] | undefined, m: string, f: string, n: string) =>
  g === 'Жінка' ? f : g === 'Чоловік' ? m : n

export const cleanHandle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const t = raw.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '')
  if (/^\+?\d[\d\s()-]{8,}$/.test(t)) return '+' + t.replace(/\D/g, '')
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(t) ? '@' + t.toLowerCase() : null
}

/** Add by @nick or phone: shown as typed; written to from the sender account when needed */
export async function addTrustedHandle(ownerId: number, raw: unknown): Promise<{ ok: true; list: Trusted[] } | { ok: false; error: string }> {
  const h = cleanHandle(raw)
  if (!h) return { ok: false, error: 'bad_handle' }
  const list = await getTrusted(ownerId)
  if (list.some((t) => t.label === h)) return { ok: false, error: 'exists' }
  if (list.length >= 3) return { ok: false, error: 'too_many' }
  const id = randomBytes(9).toString('base64url')
  const next = [...list, { handle: id, label: h, status: 'ok' as const, invitedAt: Math.floor(Date.now() / 1000) }]
  await saveTrusted(ownerId, next)
  await phCapture('trusted_added', String(ownerId), { by: h.startsWith('+') ? 'phone' : 'nick' })
  return { ok: true, list: next }
}

/** A new invite: the owner shares the link, the person opens it in Telegram */
export async function inviteTrusted(
  ownerId: number,
  rawLabel: unknown,
): Promise<{ ok: true; list: Trusted[]; id: string } | { ok: false; error: string }> {
  const label = typeof rawLabel === 'string' ? rawLabel.trim().slice(0, 30) : ''
  if (!label) return { ok: false, error: 'no_label' }
  const list = await getTrusted(ownerId)
  if (list.filter((t) => t.status !== 'no').length >= 3) return { ok: false, error: 'too_many' }
  const id = randomBytes(9).toString('base64url')
  const next = [...list, { handle: id, label, status: 'wait' as const, invitedAt: Math.floor(Date.now() / 1000) }]
  await saveTrusted(ownerId, next)
  await kv('SET', `tinv:${id}`, String(ownerId), 'EX', 30 * 86400)
  await phCapture('trusted_invited', String(ownerId), {})
  return { ok: true, list: next, id }
}

export async function removeTrusted(uid: number, id: string) {
  const list = await getTrusted(uid)
  const t = list.find((x) => x.handle === id)
  await saveTrusted(
    uid,
    list.filter((x) => x.handle !== id),
  )
  await kv('DEL', `tinv:${id}`)
  if (t?.chatId) await kv('SREM', `gidx:${t.chatId}`, `${uid}:${id}`)
}

/** /start tr_<id> in the bot: who invites, and whether it's still open */
export async function openInvite(id: string, from: { id: number }) {
  const owner = Number((await kv('GET', `tinv:${id}`)) as string | null)
  if (!owner) return null
  if (owner === from.id) return { self: true as const }
  const t = (await getTrusted(owner)).find((x) => x.handle === id)
  if (!t) return null
  const p = (await kv('GET', `profile:${owner}`)) as string | null
  const gender = p ? (JSON.parse(p) as { gender?: SafetyState['gender'] }).gender : undefined
  const ownerName = ((await kv('GET', `uname:${owner}`)) as string | null) ?? 'Твій знайомий'
  return { self: false as const, owner, ownerName, gender, status: t.status }
}

/** «Так» / «Ні» on the invite */
export async function answerInvite(id: string, from: { id: number; first_name?: string; username?: string }, yes: boolean) {
  const owner = Number((await kv('GET', `tinv:${id}`)) as string | null)
  if (!owner || owner === from.id) return null
  const list = await getTrusted(owner)
  const t = list.find((x) => x.handle === id)
  if (!t) return null
  t.status = yes ? 'ok' : 'no'
  if (yes) {
    t.chatId = from.id
    t.name = from.first_name
    t.username = from.username
    await kv('SADD', `gidx:${from.id}`, `${owner}:${id}`)
  }
  await saveTrusted(owner, list)
  const who = [from.first_name, from.username ? '@' + from.username : ''].filter(Boolean).join(' ')
  await tg('sendMessage', {
    chat_id: owner,
    text: yes
      ? `🛡 ${t.label} (${who}) тепер твоя довірена людина. Увімкни підстраховку в матчі — і вона знатиме, де ти.`
      : `${t.label} (${who}) не змогли бути довіреною людиною. Можна запросити когось іншого в профілі.`,
  })
  await phCapture('trusted_answered', String(owner), { yes })
  return { label: t.label }
}

/** /stop from a trusted person: stop being trusted for everyone */
export async function stopBeingTrusted(chatId: number) {
  const entries = ((await kv('SMEMBERS', `gidx:${chatId}`)) as string[]) ?? []
  for (const e of entries) {
    const [uid, id] = e.split(':')
    const list = await getTrusted(Number(uid))
    const t = list.find((x) => x.handle === id)
    if (!t) continue
    t.status = 'no'
    await saveTrusted(Number(uid), list)
    await tg('sendMessage', { chat_id: Number(uid), text: `${t.label} більше не довірена людина. Можна запросити когось іншого в профілі.` })
  }
  await kv('DEL', `gidx:${chatId}`)
  return entries.length
}

/* ---------- safety net ---------- */

export async function getSafety(uid: number): Promise<SafetyState | null> {
  const raw = (await kv('GET', `safety:${uid}`)) as string | null
  return raw ? (JSON.parse(raw) as SafetyState) : null
}
async function saveSafety(s: SafetyState) {
  const ttl = Math.max(60, Math.ceil((s.until - Date.now()) / 1000) + 24 * 3600)
  await kv('SET', `safety:${s.uid}`, JSON.stringify(s), 'EX', ttl)
  await kv('SET', `safetok:${s.token}`, String(s.uid), 'EX', ttl)
}

export const safetyLink = (s: SafetyState) => `${SITE}/safe?t=${s.token}`

/** "21:00" today in Kyiv → ms */
function kyivTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date()
  const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }))
  const offset = kyiv.getTime() - now.getTime()
  const t = new Date(kyiv)
  t.setHours(h, m, 0, 0)
  if (t.getTime() < kyiv.getTime() - 6 * 3600_000) t.setDate(t.getDate() + 1) // after midnight
  return t.getTime() - offset
}

async function toGuardians(s: SafetyState, html: string) {
  const list = (await getTrusted(s.uid)).filter((t) => s.guardians.includes(t.handle) && t.status === 'ok')
  let sent = 0
  // Agreed through the bot: the bot writes
  for (const t of list.filter((x) => x.chatId)) {
    const r = await tg('sendMessage', { chat_id: t.chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
    if (r.ok) sent++
  }
  // Added by @nick / phone: the sender account writes
  const byHandle = list.filter((x) => !x.chatId && (x.label.startsWith('@') || x.label.startsWith('+')))
  if (byHandle.length && (await senderReady())) {
    let changed = false
    await withSender(async (c) => {
      for (const t of byHandle) {
        if (!t.peer) {
          const p = await findPerson(c, t.label.replace(/^@/, '')).catch(() => null)
          if (!p) continue
          t.peer = p
          changed = true
        }
        await sendText(c, t.peer, html)
          .then(() => sent++)
          .catch(() => {})
      }
    }).catch(() => {})
    if (changed) {
      const all = await getTrusted(s.uid)
      for (const t of byHandle) {
        const x = all.find((a) => a.handle === t.handle)
        if (x && t.peer) x.peer = t.peer
      }
      await saveTrusted(s.uid, all)
    }
  }
  return sent
}

export async function startSafety(
  user: { id: number; first_name: string },
  gender: SafetyState['gender'],
  b: Record<string, unknown>,
): Promise<{ ok: true; safety: SafetyState } | { ok: false; error: string }> {
  const trusted = await getTrusted(user.id)
  const guardians = (Array.isArray(b.guardians) ? b.guardians : [])
    .map(cleanId)
    .filter((h): h is string => Boolean(h) && trusted.some((t) => t.handle === h && t.status === 'ok'))
  if (!guardians.length) return { ok: false, error: 'no_guardians' }
  const time = typeof b.time === 'string' && /^\d{1,2}:\d{2}$/.test(b.time) ? b.time : '19:00'
  const checkAt = typeof b.checkAt === 'string' && /^\d{1,2}:\d{2}$/.test(b.checkAt) ? b.checkAt : time
  const lat = Number(b.lat)
  const lon = Number(b.lon)
  const old = await getSafety(user.id)
  if (old) await kv('DEL', `safetok:${old.token}`)
  const s: SafetyState = {
    uid: user.id,
    name: user.first_name,
    gender,
    token: randomBytes(12).toString('base64url'),
    matchId: String(b.matchId ?? '').slice(0, 60),
    guardians,
    time,
    place: String(b.place ?? '').slice(0, 120),
    address: typeof b.address === 'string' ? b.address.slice(0, 160) : undefined,
    withName: typeof b.withName === 'string' ? b.withName.slice(0, 40) : undefined,
    withAge: Number(b.withAge) > 0 ? Number(b.withAge) : undefined,
    venue: Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat, lon } : undefined,
    checkAt: kyivTime(checkAt),
    until: kyivTime(time) + 3 * 3600_000,
    fence: b.fence !== false && Number(b.fenceKm ?? 1) > 0,
    fenceKm: [0.5, 1, 2].includes(Number(b.fenceKm)) ? Number(b.fenceKm) : 1,
    answerMin: [5, 10, 15].includes(Number(b.answerMin)) ? Number(b.answerMin) : undefined,
    live: false,
    startedAt: Date.now(),
  }
  await saveSafety(s)
  await kv('SADD', 'safety:active', user.id)
  const withWho = s.withName ? `\nЗ ким: ${esc(s.withName)}${s.withAge ? `, ${s.withAge}` : ''}.` : ''
  await toGuardians(
    s,
    `🛡 <b>${esc(s.name)} на зустрічі</b> сьогодні о ${s.time}: ${esc(s.place)}${s.address ? `, ${esc(s.address)}` : ''}.${withWho}\n\nДе ${verb(s.gender, 'він', 'вона', 'людина')} зараз: ${safetyLink(s)}\nПідстраховка до ${hhmm(s.until)}. Нічого робити не треба — напишемо, якщо ${esc(s.name)} не відповідатиме.`,
  )
  await phCapture('safety_started', String(user.id), { guardians: guardians.length, fence: s.fence })
  return { ok: true, safety: s }
}

const fenceText = (s: SafetyState) => ((s.fenceKm ?? 1) < 1 ? `${(s.fenceKm ?? 1) * 1000} м` : `${s.fenceKm ?? 1} км`)

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })

export async function stopSafety(uid: number, reason: 'user' | 'expired') {
  const s = await getSafety(uid)
  if (!s) return
  await kv('SREM', 'safety:active', uid)
  await kv('DEL', `safety:${uid}`, `safetok:${s.token}`)
  if (reason === 'user')
    await toGuardians(s, `✅ ${esc(s.name)} ${verb(s.gender, 'завершив', 'завершила', 'завершив(ла)')} зустріч: все добре. Дякуємо, що були поруч.`)
  await phCapture('safety_stopped', String(uid), { reason, alarm: Boolean(s.alarm) })
}

/* ---------- live location from the bot ---------- */

export async function onLocation(uid: number, lat: number, lon: number) {
  const s = await getSafety(uid)
  if (!s) return false
  const firstFix = !s.live
  s.live = true
  s.last = { lat, lon, at: Date.now() }
  if (s.asked?.kind === 'lost') s.asked = undefined // it's back
  if (s.venue && s.fence) {
    if (km(s.venue, s.last) > (s.fenceKm ?? FENCE_KM)) s.outsideSince ??= Date.now()
    else s.outsideSince = undefined
  }
  await saveSafety(s)
  if (firstFix) {
    await tg('sendMessage', {
      chat_id: uid,
      text: `✓ Бачу тебе. О ${hhmm(s.checkAt)} спитаю, чи все добре.${s.fence && s.venue ? ` Підеш далі ${fenceText(s)} від місця зустрічі — теж спитаю.` : ''}\n\nУ небезпеці — дзвони 112.`,
    })
  }
  await tick(s)
  return true
}

/* ---------- the clock ---------- */

const QUESTIONS = {
  check: '🙂 Як зустріч? Все добре?',
  fence: '📍 Ти вже далеко від місця зустрічі. Все гаразд?',
  lost: 'Я давно не бачу твою геопозицію. Все добре?',
}

async function ask(s: SafetyState, kind: 'check' | 'fence' | 'lost') {
  const buttons =
    kind === 'fence'
      ? [[{ text: 'Все гаразд', callback_data: 'sf:ok' }], [{ text: 'Ми гуляємо, вимкни зону', callback_data: 'sf:zone' }]]
      : kind === 'check'
        ? [[{ text: 'Все добре', callback_data: 'sf:ok' }], [{ text: 'Спитай ще через годину', callback_data: 'sf:more' }]]
        : [[{ text: 'Все добре', callback_data: 'sf:ok' }]]
  const r = await tg('sendMessage', { chat_id: s.uid, text: QUESTIONS[kind], reply_markup: { inline_keyboard: buttons } })
  const wait = s.answerMin && kind !== 'lost' ? s.answerMin * MIN : ANSWER[kind]
  s.asked = { kind, at: Date.now(), deadline: Date.now() + wait, msgId: (r.result as { message_id?: number })?.message_id }
}

const REASON = {
  check: (s: SafetyState) => `не ${verb(s.gender, 'відповів', 'відповіла', 'відповіла(в)')} на «Все добре?» о ${hhmm(s.checkAt)}`,
  fence: (s: SafetyState) => `${verb(s.gender, 'пішов', 'пішла', 'пішла(в)')} далі ${fenceText(s)} від місця зустрічі і не відповідає`,
  lost: (s: SafetyState) =>
    `зник${verb(s.gender, '', 'ла', '(ла)')} зі зв’язку${s.last ? ` о ${hhmm(s.last.at)}` : ''} і не відповідає`,
}

async function raise(s: SafetyState, kind: 'check' | 'fence' | 'lost') {
  s.alarm = { kind, at: Date.now() }
  s.asked = undefined
  await saveSafety(s)
  await toGuardians(
    s,
    `🚨 <b>${esc(s.name)} ${REASON[kind](s)}.</b>\n\nОстання геопозиція: ${safetyLink(s)}\nПодзвоніть ${verb(s.gender, 'йому', 'їй', 'їй')}. Якщо не відповідає — 112.`,
  )
  await tg('sendMessage', {
    chat_id: s.uid,
    text: 'Я написав твоїм довіреним людям, що ти не відповідаєш. Якщо все добре — натисни, і я їм скажу.',
    reply_markup: { inline_keyboard: [[{ text: 'Все добре, скасувати тривогу', callback_data: 'sf:clear' }]] },
  })
  await phCapture('safety_alarm', String(s.uid), { kind })
}

/** Decide what's due for one safety net. Safe to call any time, as often as you like. */
export async function tick(s: SafetyState) {
  const now = Date.now()
  if (now > s.until) return stopSafety(s.uid, 'expired')
  if (s.alarm) return
  let dirty = false
  if (s.asked && now >= s.asked.deadline) return raise(s, s.asked.kind)
  if (!s.asked) {
    if (!s.checkDone && now >= s.checkAt) {
      await ask(s, 'check')
      dirty = true
    } else if (s.fence && s.outsideSince && now - s.outsideSince >= MIN) {
      await ask(s, 'fence')
      dirty = true
    } else if (s.live && s.last && now - s.last.at >= SILENCE) {
      await ask(s, 'lost')
      dirty = true
    }
  }
  if (dirty) await saveSafety(s)
}

export async function tickAll() {
  const ids = ((await kv('SMEMBERS', 'safety:active')) as string[]).map(Number)
  let n = 0
  for (const uid of ids) {
    const s = await getSafety(uid)
    if (!s) {
      await kv('SREM', 'safety:active', uid)
      continue
    }
    await tick(s)
    n++
  }
  return n
}

/* ---------- answers in the bot ---------- */

export async function onAnswer(uid: number, a: string): Promise<string> {
  const s = await getSafety(uid)
  if (!s) return 'Підстраховка вже вимкнена'
  if (a === 'clear') {
    const was = s.alarm
    s.alarm = undefined
    s.asked = undefined
    s.outsideSince = undefined
    if (was?.kind === 'check') s.checkDone = true
    await saveSafety(s)
    if (was) await toGuardians(s, `✅ ${esc(s.name)} ${verb(s.gender, 'відповів', 'відповіла', 'відповів(ла)')}: все добре. Вибачте за тривогу.`)
    return 'Написав, що все добре'
  }
  if (s.alarm) return 'Тривогу вже надіслано. Натисни «Все добре, скасувати тривогу»'
  const kind = s.asked?.kind
  s.asked = undefined
  if (kind === 'check' || !kind) s.checkDone = a !== 'more' ? true : s.checkDone
  if (a === 'more') {
    s.checkAt = Date.now() + 60 * MIN
    s.checkDone = false
  }
  if (a === 'zone') s.fence = false
  if (kind === 'fence') s.outsideSince = undefined
  await saveSafety(s)
  return a === 'more' ? `Добре, спитаю о ${hhmm(s.checkAt)}` : a === 'zone' ? 'Зону вимкнув' : 'Супер, гарного вечора!'
}

/* ---------- the trusted person's page ---------- */

export async function publicView(token: string) {
  const uid = Number((await kv('GET', `safetok:${token}`)) as string | null)
  if (!uid) return null
  const s = await getSafety(uid)
  if (!s || s.token !== token) return null
  await tick(s).catch(() => {})
  const fresh = (await getSafety(uid)) ?? s
  return {
    name: fresh.name,
    time: fresh.time,
    place: fresh.place,
    address: fresh.address,
    withName: fresh.withName,
    withAge: fresh.withAge,
    venue: fresh.venue,
    until: fresh.until,
    live: fresh.live,
    last: fresh.last,
    alarm: fresh.alarm ? { kind: fresh.alarm.kind, at: fresh.alarm.at, text: REASON[fresh.alarm.kind](fresh) } : null,
  }
}

export const ok = json
