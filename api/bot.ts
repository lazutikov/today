/**
 * Telegram bot webhook.
 *  /start login_<code>  confirms a website sign-in and says "go back to the site"
 *  /start (anything)    greets and offers to open the prototype inside Telegram
 *  /delete              removes the person's data (after a confirm button)
 *  buttons: Так/Ні on requests, «Зустрілися?» answers, mute, owner's Block
 * Telegram proves it is Telegram with the secret_token set in /api/bot-setup.
 */
import { createHash } from 'node:crypto'
import { CODE_RE, CODE_TTL, json, kv, kvReady, ownerId, OWNER_USERNAME, phCapture, tg } from './_kv.js'
import { answerReq, deleteUser, saveOutcome, type Outcome } from './_social.js'
import { setNotify } from './_profile.js'

export function webhookSecret(token: string) {
  return createHash('sha256').update(`today-webhook:${token}`).digest('hex').slice(0, 48)
}

type Update = {
  callback_query?: {
    id: string
    from: { id: number; username?: string }
    data?: string
    message?: { chat: { id: number }; message_id: number; text?: string }
  }
  message?: {
    chat: { id: number }
    text?: string
    from?: { id: number; first_name?: string; username?: string }
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return json({ ok: false }, 500)
  if (request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret(token)) return json({ ok: false }, 401)

  const update = (await request.json()) as Update

  const cb = update.callback_query

  // «Зустрілися?» the morning after
  if (cb?.data?.startsWith('m:')) {
    const [, id, outcome] = cb.data.split(':')
    const ok = await saveOutcome(id, cb.from.id, outcome as Outcome)
    const label = { met: 'Зустрілися 👍', noshow: 'Не прийшли', off: 'Скасували' }[outcome as Outcome] ?? ''
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: ok ? 'Дякуємо, це дуже допомагає!' : 'Не знайшли цю зустріч' })
    if (ok && cb.message)
      await tg('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: `${cb.message.text ?? ''}\n\nТвоя відповідь: ${label}. Дякуємо!`,
      })
    return json({ ok: true })
  }

  // Owner's decision on a report
  if (cb?.data?.startsWith('block:') || cb?.data === 'noop') {
    const owner = await ownerId()
    if (!owner || cb.from.id !== owner) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Це не для тебе' })
      return json({ ok: true })
    }
    if (cb.data.startsWith('block:')) {
      const target = Number(cb.data.split(':')[1])
      await kv('SADD', 'blocked', target)
      await phCapture('user_blocked', String(target))
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: cb.data === 'noop' ? 'Залишили' : 'Заблоковано' })
    if (cb.message)
      await tg('editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } })
    return json({ ok: true })
  }

  // Delete my data: confirmed
  if (cb?.data === 'del:yes') {
    await deleteUser(cb.from.id)
    await phCapture('user_deleted', String(cb.from.id))
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Видалено' })
    if (cb.message)
      await tg('editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: 'Готово: твій профіль, пости й сповіщення видалено. Якщо захочеш повернутися, просто увійди знову.',
      })
    return json({ ok: true })
  }

  // "Так" / "Ні" under an invite or join request
  if (cb?.data === 'mute') {
    await setNotify(cb.from.id, false)
    await tg('answerCallbackQuery', {
      callback_query_id: cb.id,
      text: 'Більше не надсилатиму. Увімкнути можна в профілі today.',
      show_alert: true,
    })
    return json({ ok: true })
  }
  if (cb?.data?.startsWith('r:')) {
    const [, id, a] = cb.data.split(':')
    const res = await answerReq(id, cb.from.id, a === 'y')
    const note = res.message
      ? res.message
      : res.ok
      ? a === 'y'
        ? 'Є матч! Контакт надіслано'
        : 'Відмову надіслано'
      : res.status === 'expired'
        ? 'Час на відповідь вийшов'
        : 'На це вже відповіли'
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: note, show_alert: Boolean(res.message) })
    return json({ ok: true })
  }

  const msg = update.message
  // The owner is recognised by username; remember their chat to send reports there
  if (msg?.from?.username && msg.from.username.toLowerCase() === OWNER_USERNAME)
    await kv('SET', 'owner:id', msg.from.id)

  if (msg?.from && msg.text?.startsWith('/delete')) {
    await send(token, msg.chat.id, 'Видалити твої дані з today? Профіль, твої пости на сьогодні та сповіщення зникнуть.', {
      inline_keyboard: [[{ text: 'Так, видалити', callback_data: 'del:yes' }]],
    })
    return json({ ok: true })
  }

  if (!msg?.from || !msg.text?.startsWith('/start')) return json({ ok: true })

  const site = `https://${request.headers.get('host')}`
  const arg = msg.text.split(' ')[1] || ''

  if (arg.startsWith('login_')) {
    const code = arg.slice('login_'.length)
    const known = CODE_RE.test(code) && kvReady ? await kv('GET', `login:${code}`) : null
    if (known === 'pending') {
      const user = { id: msg.from.id, first_name: msg.from.first_name ?? '', username: msg.from.username ?? null, photo_url: null }
      await kv('SET', `login:${code}`, JSON.stringify(user), 'EX', CODE_TTL)
      await send(
        token,
        msg.chat.id,
        `Готово, ${msg.from.first_name || 'привіт'}! Ти увійшов у today 👋\n\nПовертайся на сайт: вкладка вже відкрилась сама. Якщо загубив її, тисни кнопку.`,
        { inline_keyboard: [[{ text: 'Повернутися в today', url: `${site}/app?login=${code}` }]] },
      )
    } else if (known) {
      // Already confirmed (Start tapped twice): just offer the way back again.
      await send(token, msg.chat.id, 'Ти вже увійшов 👌', {
        inline_keyboard: [[{ text: 'Повернутися в today', url: `${site}/app?login=${code}` }]],
      })
    } else {
      await send(token, msg.chat.id, 'Це посилання для входу вже не діє. Натисни «Увійти через Telegram» на сайті ще раз.', {
        inline_keyboard: [[{ text: 'Відкрити сайт', url: `${site}/app` }]],
      })
    }
    return json({ ok: true })
  }

  await send(token, msg.chat.id, 'Привіт! Це today — компанія на сьогодні у Львові. Відкривай і дивись, хто вільний поруч 👇', {
    inline_keyboard: [[{ text: 'Відкрити today', web_app: { url: `${site}/app` } }]],
  })
  return json({ ok: true })
}

async function send(token: string, chatId: number, text: string, reply_markup?: unknown) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup }),
  })
}
