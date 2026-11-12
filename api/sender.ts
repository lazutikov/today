/**
 * Connect the «today · безпека» account (owner only, once).
 *  GET    /api/sender                       status
 *  POST   /api/sender {phone}               Telegram sends a login code to that account
 *  POST   /api/sender {code, password?}     finish sign-in (password = 2FA, if set)
 *  DELETE /api/sender                       disconnect
 */
import { json, OWNER_USERNAME, readJson, readSession, wipeKeys } from './_kv.js'
import QRCode from 'qrcode'
import { loginFinish, loginResend, loginSendCode, logoutSender, qrStep, renamedContacts, senderConfigured, senderReady } from './_sender.js'

const isOwner = (request: Request) => readSession(request)?.username?.toLowerCase() === OWNER_USERNAME

export async function GET(request: Request): Promise<Response> {
  if (!isOwner(request)) return json({ ok: false, error: 'owner_only' }, 403)
  const account = await senderReady()
  const renamed = account ? await renamedContacts().catch(() => []) : []
  return json({ ok: true, configured: senderConfigured, account, renamed })
}

export async function POST(request: Request): Promise<Response> {
  if (!isOwner(request)) return json({ ok: false, error: 'owner_only' }, 403)
  const b = await readJson<{ phone?: string; code?: string; password?: string; resend?: boolean; qr?: boolean; wipe?: string }>(request)
  // Owner only: remove every user's data (profiles, posts, matches, Safety mode). Not the sender account.
  if (b?.wipe === 'ВИДАЛИТИ') {
    const n = await wipeKeys([
      'profile:*', 'mypost:*', 'post:*', 'posts:*', 'req:*', 'reqs:*', 'inbox:*', 'matches:*', 'meetings:*',
      'notif:*', 'notifseen:*', 'tgphoto:*', 'area:*', 'subs:*', 'pings:*', 'checkin:*', 'outcome:*',
      'trusted:*', 'safety:*', 'safetok:*', 'tinv:*', 'gidx:*', 'uname:*', 'login:*', 'outgoing:*', 'safety:active',
    ])
    return json({ ok: true, deleted: n })
  }
  if (!senderConfigured) return json({ ok: false, error: 'no_api_id' }, 400)
  try {
    if (b?.phone) {
      const phone = '+' + b.phone.replace(/\D/g, '')
      if (phone.length < 10) return json({ ok: false, error: 'bad_phone' }, 400)
      return json({ ok: true, step: 'code', sent: await loginSendCode(phone) })
    }
    if (b && 'qr' in b) {
      const r = await qrStep(Boolean((b as { fresh?: boolean }).fresh))
      if (r.state === 'show') return json({ ok: true, ...r, svg: await QRCode.toString(r.url, { type: 'svg', margin: 1, width: 240 }) })
      return json({ ok: true, ...r, account: r.state === 'ok' ? await senderReady() : null })
    }
    if (b && 'resend' in b) {
      const sent = await loginResend()
      return sent ? json({ ok: true, step: 'code', sent }) : json({ ok: false, error: 'expired' }, 400)
    }
    if (b?.code || b?.password) {
      const r = await loginFinish((b.code ?? '').replace(/\D/g, ''), b.password || undefined)
      return json({ ok: r === 'ok', step: r, account: r === 'ok' ? await senderReady() : null })
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message.slice(0, 120) : 'failed' }, 502)
  }
  return json({ ok: false, error: 'bad_request' }, 400)
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isOwner(request)) return json({ ok: false, error: 'owner_only' }, 403)
  await logoutSender()
  return json({ ok: true })
}
