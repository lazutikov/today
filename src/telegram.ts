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

/** t.me link to the bot with a /start argument */
export const botStartLink = (arg: string) => (BOT_NAME ? `https://t.me/${BOT_NAME}?start=${arg}` : null)

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
  saveTgUser(body.user, body.session)
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
    await new Promise((r) => setTimeout(r, 300))
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
  saveTgUser(body.user, body.session)
  return body.user
}

/* ---------- Sign-in through the bot (site, no phone number) ---------- */

export type BotLogin = { code: string; link: string }

/** Registers a one-time code. Null when the server has no storage yet (then use the widget). */
export async function prepareBotLogin(): Promise<BotLogin | null> {
  if (!BOT_NAME) return null
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) return null
  } catch {
    return null
  }
  return { code, link: `https://t.me/${BOT_NAME}?start=login_${code}` }
}

/** Makes a code right in the click (no waiting), registration runs in the background. */
export function startBotLogin(): BotLogin | null {
  if (!BOT_NAME) return null
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
    keepalive: true,
  }).catch(() => {})
  return { code, link: `https://t.me/${BOT_NAME}?start=login_${code}` }
}

/** Rebuilds the bot link for a code registered elsewhere (the site's button). */
export function botFromCode(code: string): BotLogin | null {
  return BOT_NAME ? { code, link: `https://t.me/${BOT_NAME}?start=login_${code}` } : null
}

/** Polls until the user taps Start in the bot. Rejects on expiry or abort. */
export function waitForBotLogin(code: string, signal: AbortSignal): Promise<TgUser> {
  return new Promise((resolve, reject) => {
    let timer = 0
    const check = async () => {
      if (signal.aborted) return reject(new Error('aborted'))
      try {
        const res = await fetch(`/api/login?code=${code}`, { cache: 'no-store' })
        const body = await res.json()
        if (body.ok) {
          cleanup()
          saveTgUser(body.user, body.session)
          return resolve(body.user)
        }
        if (res.status === 410) {
          cleanup()
          return reject(new Error('expired'))
        }
      } catch {
        /* network blip: keep polling */
      }
      timer = window.setTimeout(check, 1500)
    }
    // Coming back from Telegram: check right away instead of waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer)
        check()
      }
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    document.addEventListener('visibilitychange', onVisible)
    signal.addEventListener('abort', () => {
      cleanup()
      reject(new Error('aborted'))
    })
    check()
  })
}

export function loadTgUser(): TgUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const SESSION_KEY = 'today.session.v1'

/** Signed by our server; lets the app read and write the shared feed. */
export function loadSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function saveTgUser(u: TgUser, session?: string) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, session)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  } catch {
    /* memory only */
  }
}

export function clearTgUser() {
  try {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
