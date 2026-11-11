/**
 * Telegram Login. With VITE_TG_BOT_ID set, opens Telegram's own login popup,
 * then the server checks the signature in /api/auth. Without it (artifact
 * preview, local dev) the prototype keeps the fake 1.2s login.
 */

export type TgUser = { id: number; first_name: string; username: string | null; photo_url: string | null }

const BOT_ID = import.meta.env.VITE_TG_BOT_ID as string | undefined
const BOT_NAME = import.meta.env.VITE_TG_BOT_NAME as string | undefined
const USER_KEY = 'today.tgUser'

/** t.me link that opens the prototype inside Telegram, already signed in. Null without a bot. */
export function miniAppLink(city: string): string | null {
  return BOT_NAME ? `https://t.me/${BOT_NAME}?startapp=${city}` : null
}

export const telegramEnabled = Boolean(BOT_ID)

type WebApp = {
  initData: string
  initDataUnsafe?: { start_param?: string }
  ready: () => void
  expand: () => void
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  disableVerticalSwipes?: () => void
}

/** Telegram's Mini App object, only when the page is really opened inside Telegram. */
export function miniApp(): WebApp | null {
  try {
    const wa = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp
    return wa && wa.initData ? wa : null
  } catch {
    return null
  }
}

export const inMiniApp = Boolean(miniApp())

/** Call once on start inside Telegram: full height, light chrome, no swipe-to-close fighting our sheets. */
export function setupMiniApp() {
  const wa = miniApp()
  if (!wa) return
  try {
    wa.ready()
    wa.expand()
    wa.setHeaderColor?.('#EBEBEB')
    wa.setBackgroundColor?.('#EBEBEB')
    wa.disableVerticalSwipes?.()
  } catch {
    /* older Telegram clients lack some methods */
  }
}

/** Inside Telegram the user is already known: the server only checks the signature. */
export async function miniAppLogin(): Promise<TgUser> {
  const wa = miniApp()
  if (!wa) throw new Error('not_mini_app')
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: wa.initData }),
  })
  const body = await res.json()
  if (!body.ok) throw new Error(body.error || 'auth_failed')
  saveTgUser(body.user)
  return body.user
}

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
