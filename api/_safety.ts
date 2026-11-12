/**
 * Безпечна зустріч on the server.
 *
 * trusted:{uid}   people who said «+», written to by the «today · безпека» account
 * safety:{uid}    the safety net for one meeting: who knows, when to ask, the venue,
 *                 the last position from the bot's live location
 * safetok:{token} → uid, for the trusted person's page /safe?t=…
 * safety:active   set of uids to tick
 *
 * Every alarm asks the person first («Все добре?» in the bot) and only then
 * writes to the trusted people. Nothing is sent before they agreed with «+».
 */
import { randomBytes } from 'node:crypto'
import { esc, json, km, kv, phCapture, tg } from './_kv.js'
import { findPerson, repliesSince, sendText, withSender, type Peer } from './_sender.js'

export type Trusted = {
  handle: string
  name: string
  status: 'wait' | 'ok' | 'no'
  /** How the person who added them calls them: «Мама», «Катя з роботи» */
  label?: string
  peer?: Peer
  invitedAt: number // seconds
}

export type SafetyState = {
  uid: number
  name: string // the person's first name, as the trusted people know it
  gender?: 'Чоловік' | 'Жінка'
  token: string
  matchId: string
  guardians: string[] // handles
  time: string // meeting time "19:00"
  place: string
  address?: string
  withName?: string
  withAge?: number
  venue?: { lat: number; lon: number }
  checkAt: number // ms
  until: number // ms
  fence: boolean
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

export const cleanHandle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '')
  if (/^\+?\d[\d\s-]{8,}$/.test(s)) return '+' + s.replace(/\D/g, '')
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s) ? s.toLowerCase() : null
}

/* ---------- trusted people ---------- */

export async function getTrusted(uid: number): Promise<Trusted[]> {
  const raw = (await kv('GET', `trusted:${uid}`)) as string | null
  return raw ? (JSON.parse(raw) as Trusted[]) : []
}
async function saveTrusted(uid: number, list: Trusted[]) {
  await kv('SET', `trusted:${uid}`, JSON.stringify(list), 'EX', 365 * 86400)
}
export const publicTrusted = (l: Trusted[]) => l.map(({ handle, name, status, label }) => ({ handle, name, status, label }))

const verb = (g: SafetyState['gender'] | undefined, m: string, f: string, n: string) =>
  g === 'Жінка' ? f : g === 'Чоловік' ? m : n

export async function inviteTrusted(
  owner: { id: number; first_name: string; username: string | null; gender?: 'Чоловік' | 'Жінка' },
  rawHandle: unknown,
  rawLabel?: unknown,
): Promise<{ ok: true; list: Trusted[] } | { ok: false; error: string }> {
  const handle = cleanHandle(rawHandle)
  if (!handle) return { ok: false, error: 'bad_handle' }
  const list = await getTrusted(owner.id)
  if (list.some((t) => t.handle === handle)) return { ok: false, error: 'exists' }
  if (list.length >= 3) return { ok: false, error: 'too_many' }

  const who = `${esc(owner.first_name)}${owner.username ? ` (@${esc(owner.username)})` : ''}`
  const added = verb(owner.gender, 'додав', 'додала', 'додав(ла)')
  const result = await withSender(async (c) => {
    const peer = await findPerson(c, handle)
    if (!peer) return null
    await sendText(
      c,
      peer,
      `Привіт! Це today — сервіс зустрічей на сьогодні.\n\n<b>${who} ${added} вас як довірену людину.</b> Якщо під час зустрічі ${esc(owner.first_name)} не відповідатиме або зникне зі зв’язку, ми напишемо вам тут, де ${verb(owner.gender, 'він був', 'вона була', 'людина була')} востаннє.\n\nЗгодні? Відповідайте <b>+</b>. Відмовитися можна будь-коли словом «стоп».`,
    )
    return peer
  })
  if (!result) return { ok: false, error: handle.startsWith('+') ? 'not_found_phone' : 'not_found' }
  const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim().slice(0, 30) : undefined
  const next = [...list, { handle, name: result.name, label, status: 'wait' as const, peer: result, invitedAt: Math.floor(Date.now() / 1000) - 5 }]
  await saveTrusted(owner.id, next)
  await phCapture('trusted_invited', String(owner.id), { by: handle.startsWith('+') ? 'phone' : 'nick' })
  return { ok: true, list: next }
}

const YES = /^\s*(\+|так|згод|ок|ok|yes|да)/i
const NO = /^\s*(стоп|stop|ні|нет|no)\b/i

/** Look for «+» or «стоп» from people we're waiting on (called while the profile is open) */
export async function refreshTrusted(uid: number): Promise<Trusted[]> {
  const list = await getTrusted(uid)
  const waiting = list.filter((t) => t.status === 'wait' && t.peer)
  if (waiting.length === 0) return list
  let changed = false
  await withSender(async (c) => {
    for (const t of waiting) {
      const replies = await repliesSince(c, t.peer!, t.invitedAt).catch(() => [])
      if (replies.some((r) => NO.test(r))) {
        t.status = 'no'
        changed = true
        await sendText(c, t.peer!, 'Зрозуміли, більше не писатимемо.').catch(() => {})
      } else if (replies.some((r) => YES.test(r))) {
        t.status = 'ok'
        changed = true
        await sendText(
          c,
          t.peer!,
          'Дякуємо! Тепер ви довірена людина. Напишемо, лише коли буде зустріч з підстраховкою або якщо щось трапиться.',
        ).catch(() => {})
      }
    }
  }).catch(() => {})
  if (changed) await saveTrusted(uid, list)
  return list
}

export async function removeTrusted(uid: number, handle: string) {
  await saveTrusted(
    uid,
    (await getTrusted(uid)).filter((t) => t.handle !== handle),
  )
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
  const list = (await getTrusted(s.uid)).filter((t) => s.guardians.includes(t.handle) && t.status === 'ok' && t.peer)
  if (!list.length) return 0
  let sent = 0
  await withSender(async (c) => {
    for (const t of list) {
      await sendText(c, t.peer!, html)
        .then(() => sent++)
        .catch(() => {})
    }
  }).catch(() => {})
  return sent
}

export async function startSafety(
  user: { id: number; first_name: string },
  gender: SafetyState['gender'],
  b: Record<string, unknown>,
): Promise<{ ok: true; safety: SafetyState } | { ok: false; error: string }> {
  const trusted = await getTrusted(user.id)
  const guardians = (Array.isArray(b.guardians) ? b.guardians : [])
    .map(cleanHandle)
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
    fence: b.fence !== false,
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
    if (km(s.venue, s.last) > FENCE_KM) s.outsideSince ??= Date.now()
    else s.outsideSince = undefined
  }
  await saveSafety(s)
  if (firstFix) {
    await tg('sendMessage', {
      chat_id: uid,
      text: `✓ Бачу тебе. О ${hhmm(s.checkAt)} спитаю, чи все добре.${s.fence && s.venue ? ' Підеш далі 1 км від місця зустрічі — теж спитаю.' : ''}\n\nУ небезпеці — дзвони 112.`,
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
  s.asked = { kind, at: Date.now(), deadline: Date.now() + ANSWER[kind], msgId: (r.result as { message_id?: number })?.message_id }
}

const REASON = {
  check: (s: SafetyState) => `не ${verb(s.gender, 'відповів', 'відповіла', 'відповіла(в)')} на «Все добре?» о ${hhmm(s.checkAt)}`,
  fence: (s: SafetyState) => `${verb(s.gender, 'пішов', 'пішла', 'пішла(в)')} далі 1 км від місця зустрічі і не відповідає`,
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
