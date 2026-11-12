/**
 * The «today · безпека» account: a regular Telegram account that writes to
 * trusted people (a bot can't write first). Logged in once from /sender by
 * the owner; the session lives in KV, never in the code or the chat.
 *
 * Needs TG_API_ID and TG_API_HASH (my.telegram.org → API development tools).
 */
import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'
import bigInt from 'big-integer'
import { kv } from './_kv.js'

const API_ID = Number(process.env.TG_API_ID || 0)
const API_HASH = process.env.TG_API_HASH || ''
export const senderConfigured = Boolean(API_ID && API_HASH)

const SESSION = 'sender:session'
const ME = 'sender:me'
const PENDING = 'sender:pending'

export type Peer = { id: string; hash: string; name: string; username?: string }

function client(session = '') {
  const c = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
    connectionRetries: 2,
    requestRetries: 2,
    autoReconnect: false,
  })
  c.setLogLevel('none' as never)
  return c
}

export async function senderReady(): Promise<{ username?: string; name?: string } | null> {
  if (!senderConfigured) return null
  const [s, me] = (await Promise.all([kv('GET', SESSION), kv('GET', ME)])) as [string | null, string | null]
  return s ? (me ? (JSON.parse(me) as { username?: string; name?: string }) : {}) : null
}

/** Run something as the sender account; connects for this call only (serverless). */
export async function withSender<T>(fn: (c: TelegramClient) => Promise<T>): Promise<T> {
  if (!senderConfigured) throw new Error('sender_not_configured')
  const s = (await kv('GET', SESSION)) as string | null
  if (!s) throw new Error('sender_not_connected')
  const c = client(s)
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.disconnect().catch(() => {})
    await c.destroy().catch(() => {})
  }
}

const inputPeer = (p: Peer) => new Api.InputPeerUser({ userId: bigInt(p.id), accessHash: bigInt(p.hash) })

function toPeer(u: Api.TypeUser | undefined): Peer | null {
  if (!u || !(u instanceof Api.User) || u.bot || u.deleted) return null
  return {
    id: u.id.toString(),
    hash: (u.accessHash ?? bigInt(0)).toString(),
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Без імені',
    username: u.username ?? undefined,
  }
}

/** @nick or +380… → a person we can write to, or null if Telegram doesn't show them */
export async function findPerson(c: TelegramClient, handle: string): Promise<Peer | null> {
  try {
    if (handle.startsWith('+')) {
      const r = await c.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({ clientId: bigInt(Date.now()), phone: handle, firstName: 'today', lastName: handle }),
          ],
        }),
      )
      return toPeer(r.users[0])
    }
    const r = await c.invoke(new Api.contacts.ResolveUsername({ username: handle }))
    return toPeer(r.users[0])
  } catch {
    return null
  }
}

export async function sendText(c: TelegramClient, p: Peer, html: string) {
  await c.sendMessage(inputPeer(p), { message: html, parseMode: 'html', linkPreview: false })
}

/** Latest replies from the person after a moment (seconds since epoch) */
export async function repliesSince(c: TelegramClient, p: Peer, since: number): Promise<string[]> {
  const msgs = await c.getMessages(inputPeer(p), { limit: 10 })
  return msgs.filter((m) => !m.out && m.date >= since && typeof m.message === 'string').map((m) => m.message)
}

/* ---------- One-time login by the owner ---------- */

/** Where Telegram sent the code: app chat, SMS, email, call… */
function codeWhere(r: unknown): { type: string; next?: string; email?: string } {
  const o = r as { className?: string; type?: { className?: string; emailPattern?: string }; nextType?: { className?: string } }
  const short = (s?: string) => (s ?? '').replace(/^auth\.(SentCodeType|CodeType)/, '')
  return { type: o.type ? short(o.type.className) : short(o.className), next: short(o.nextType?.className) || undefined, email: o.type?.emailPattern }
}

export async function loginSendCode(phone: string) {
  const c = client()
  await c.connect()
  try {
    const r = await c.invoke(
      new Api.auth.SendCode({ phoneNumber: phone, apiId: API_ID, apiHash: API_HASH, settings: new Api.CodeSettings({}) }),
    )
    const hash = 'phoneCodeHash' in r ? r.phoneCodeHash : ''
    await kv('SET', PENDING, JSON.stringify({ phone, hash, session: c.session.save() }), 'EX', 600)
    return codeWhere(r)
  } finally {
    await c.disconnect().catch(() => {})
    await c.destroy().catch(() => {})
  }
}

/** Ask Telegram to send the code again (often by SMS the second time) */
export async function loginResend() {
  const raw = (await kv('GET', PENDING)) as string | null
  if (!raw) return null
  const pending = JSON.parse(raw) as { phone: string; hash: string; session: string }
  const c = client(pending.session)
  await c.connect()
  try {
    const r = await c.invoke(new Api.auth.ResendCode({ phoneNumber: pending.phone, phoneCodeHash: pending.hash }))
    const hash = 'phoneCodeHash' in r ? r.phoneCodeHash : pending.hash
    await kv('SET', PENDING, JSON.stringify({ ...pending, hash, session: c.session.save() }), 'EX', 600)
    return codeWhere(r)
  } finally {
    await c.disconnect().catch(() => {})
    await c.destroy().catch(() => {})
  }
}

export async function loginFinish(code: string, password?: string): Promise<'ok' | 'need_password' | 'expired' | 'bad_code' | 'bad_password'> {
  const raw = (await kv('GET', PENDING)) as string | null
  if (!raw) return 'expired'
  const pending = JSON.parse(raw) as { phone: string; hash: string; session: string; needPassword?: boolean }
  const c = client(pending.session)
  await c.connect()
  try {
    let needPassword = Boolean(pending.needPassword)
    if (!needPassword) {
      try {
        await c.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: code }))
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('SESSION_PASSWORD_NEEDED')) {
          needPassword = true
          await kv('SET', PENDING, JSON.stringify({ ...pending, session: c.session.save(), needPassword }), 'EX', 600)
          if (!password) return 'need_password'
        } else if (msg.includes('PHONE_CODE_EXPIRED')) return 'expired'
        else return 'bad_code'
      }
    }
    if (needPassword) {
      if (!password) return 'need_password'
      try {
        const pwd = await c.invoke(new Api.account.GetPassword())
        await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }))
      } catch {
        return 'bad_password'
      }
    }
    const me = await c.getMe()
    await kv('SET', SESSION, c.session.save() as unknown as string)
    await kv('SET', ME, JSON.stringify({ username: me.username, name: [me.firstName, me.lastName].filter(Boolean).join(' ') }))
    await kv('DEL', PENDING)
    return 'ok'
  } finally {
    await c.disconnect().catch(() => {})
    await c.destroy().catch(() => {})
  }
}

/* ---------- QR login: scan in Telegram → Settings → Devices → Link Desktop Device ---------- */

const QR = 'sender:qr'

async function saveMe(c: TelegramClient) {
  const me = await c.getMe()
  await kv('SET', SESSION, c.session.save() as unknown as string)
  await kv('SET', ME, JSON.stringify({ username: me.username, name: [me.firstName, me.lastName].filter(Boolean).join(' ') }))
  await kv('DEL', QR, PENDING)
}

/**
 * Start or continue a QR login. Each call asks Telegram once:
 * a fresh token to show (not scanned yet), 'ok' when accepted on the phone,
 * or 'need_password' when the account has 2FA.
 */
export async function qrStep(fresh = false): Promise<{ state: 'show'; url: string; expires: number; debug?: string } | { state: 'ok' } | { state: 'need_password' }> {
  if (fresh) await kv('DEL', QR)
  const saved = (await kv('GET', QR)) as string | null
  const c = client(saved ?? '')
  await c.connect()
  try {
    // Scanned since the last poll: this connection is already signed in
    if (saved && (await c.checkAuthorization().catch(() => false))) {
      await saveMe(c)
      return { state: 'ok' }
    }
    let r: Api.auth.TypeLoginToken
    try {
      r = await c.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('SESSION_PASSWORD_NEEDED')) {
        await kv('SET', PENDING, JSON.stringify({ phone: '', hash: '', session: c.session.save(), needPassword: true }), 'EX', 600)
        return { state: 'need_password' }
      }
      throw e
    }
    if (r instanceof Api.auth.LoginTokenMigrateTo) {
      await c._switchDC(r.dcId)
      try {
        r = await c.invoke(new Api.auth.ImportLoginToken({ token: r.token }))
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('SESSION_PASSWORD_NEEDED')) {
          await kv('SET', PENDING, JSON.stringify({ phone: '', hash: '', session: c.session.save(), needPassword: true }), 'EX', 600)
          return { state: 'need_password' }
        }
        throw e
      }
    }
    if (r instanceof Api.auth.LoginTokenSuccess) {
      await saveMe(c)
      return { state: 'ok' }
    }
    const t = r as Api.auth.LoginToken
    const saved2 = c.session.save() as unknown as string
    await kv('SET', QR, saved2, 'EX', 600)
    const debug = `dc ${c.session.dcId} · ${saved ? 'same' : 'new'} · key ${saved2.slice(-6)} · ${(r as { className?: string }).className}`
    return { state: 'show', url: `tg://login?token=${Buffer.from(t.token).toString('base64url')}`, expires: t.expires * 1000, debug }
  } finally {
    await c.disconnect().catch(() => {})
    await c.destroy().catch(() => {})
  }
}

export async function logoutSender() {
  await kv('DEL', SESSION, ME, PENDING, QR)
}
