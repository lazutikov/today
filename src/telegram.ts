/**
 * Telegram Login. With VITE_TG_BOT_ID set, opens Telegram's own login popup,
 * then the server checks the signature in /api/auth. Without it (artifact
 * preview, local dev) the prototype keeps the fake 1.2s login.
 */

export type TgUser = { id: number; first_name: string; username: string | null; photo_url: string | null }

const BOT_ID = import.meta.env.VITE_TG_BOT_ID as string | undefined
const USER_KEY = 'today.tgUser'

export const telegramEnabled = Boolean(BOT_ID)

type Widget = { Login: { auth: (o: Record<string, unknown>, cb: (u: Record<string, unknown> | false) => void) => void } }

function loadWidget(): Promise<Widget> {
  const w = window as unknown as { Telegram?: Widget }
  if (w.Telegram?.Login) return Promise.resolve(w.Telegram)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-widget.js?22'
    s.async = true
    s.onload = () => (w.Telegram ? resolve(w.Telegram) : reject(new Error('no_widget')))
    s.onerror = () => reject(new Error('widget_load_failed'))
    document.head.appendChild(s)
  })
}

export async function telegramLogin(): Promise<TgUser> {
  if (!BOT_ID) {
    await new Promise((r) => setTimeout(r, 1200))
    const fake = { id: 0, first_name: 'Гість', username: null, photo_url: null }
    saveTgUser(fake)
    return fake
  }
  const tg = await loadWidget()
  const payload = await new Promise<Record<string, unknown>>((resolve, reject) =>
    tg.Login.auth({ bot_id: BOT_ID, request_access: 'write', lang: 'uk' }, (u) =>
      u ? resolve(u) : reject(new Error('cancelled')),
    ),
  )
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || 'auth_failed')
  saveTgUser(body.user)
  return body.user
}

export function loadTgUser(): TgUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveTgUser(u: TgUser) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  } catch {
    /* memory only */
  }
}

export function clearTgUser() {
  try {
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}
