/**
 * Telegram bot webhook.
 *  /start login_<code>  confirms a website sign-in and says "go back to the site"
 *  /start (anything)    greets and offers to open the prototype inside Telegram
 * Telegram proves it is Telegram with the secret_token set in /api/bot-setup.
 */
import { createHash } from 'node:crypto'
import { CODE_RE, CODE_TTL, json, kv, kvReady, tg } from './_kv.js'
import { answerReq } from './_social.js'

export function webhookSecret(token: string) {
  return createHash('sha256').update(`today-webhook:${token}`).digest('hex').slice(0, 48)
}

type Update = {
  callback_query?: { id: string; from: { id: number }; data?: string }
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

  // "Так" / "Ні" under an invite or join request
  const cb = update.callback_query
  if (cb?.data?.startsWith('r:')) {
    const [, id, a] = cb.data.split(':')
    const res = await answerReq(id, cb.from.id, a === 'y')
    const note = res.ok
      ? a === 'y'
        ? 'Є матч! Контакт надіслано'
        : 'Відмову надіслано'
      : res.status === 'expired'
        ? 'Час на відповідь вийшов'
        : 'На це вже відповіли'
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: note })
    return json({ ok: true })
  }

  const msg = update.message
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
