/**
 * Безпечна зустріч (prototype, client side for now).
 *
 * Trusted people live in the profile: added by Telegram @nick (or phone),
 * they get a message from the «today · безпека» account and agree with «+».
 * For a meeting the person turns on the safety net: who knows, when to ask
 * «Все добре?», and an alert when they go more than 1 km from the venue.
 * Live location itself is shared with the bot in Telegram (works in the
 * background), so the last step opens the bot.
 *
 * Signed in on the real site this talks to /api/trusted and /api/safety;
 * in demo builds the «+» and the live location are simulated.
 */
import { useEffect, useState } from 'react'
import {
  addTrustedApi,
  fetchSafety,
  fetchTrusted,
  isLive,
  removeTrustedApi,
  startSafetyApi,
  stopSafetyApi,
} from './live'
import { botStartLink } from './telegram'

/** Not public yet: always on in test builds (no bot), on the real site only with ?safety=1 (remembered) */
export const SAFETY_PREVIEW = (() => {
  if (!import.meta.env.VITE_TG_BOT_ID) return true
  try {
    const q = new URLSearchParams(location.search).get('safety')
    if (q === '1') localStorage.setItem('today.safetyPreview', '1')
    if (q === '0') localStorage.removeItem('today.safetyPreview')
    return localStorage.getItem('today.safetyPreview') === '1'
  } catch {
    return false
  }
})()

export type Trusted = { handle: string; name: string; status: 'wait' | 'ok' | 'no' }
export type Safety = {
  matchId: string
  guardians: string[] // handles
  checkAt: string // "21:00"
  until: string // "22:00"
  fence: boolean
  live: boolean
  alarm?: string | null
}

const TRUSTED_KEY = 'today.trusted'
const SAFETY_KEY = 'today.safety'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode */
  }
  emit()
}

export const loadTrusted = () => read<Trusted[]>(TRUSTED_KEY, [])
export const loadSafety = () => read<Safety | null>(SAFETY_KEY, null)

/** The server has the «today · безпека» account connected: the feature is on for everyone */
let serverReady = false

/** Pull trusted people and the safety net from the server (real site only) */
export async function syncSafety() {
  if (!isLive()) return
  const [t, s] = await Promise.all([fetchTrusted().catch(() => null), fetchSafety().catch(() => null)])
  if (t) {
    serverReady = t.ready
    write(TRUSTED_KEY, t.list)
  }
  if (s) {
    const local = loadSafety()
    if (!s.safety) {
      if (local) write(SAFETY_KEY, null)
    } else {
      const hm = (ms: number) =>
        new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
      write(SAFETY_KEY, {
        matchId: s.safety.matchId,
        guardians: s.safety.guardians,
        checkAt: hm(s.safety.checkAt),
        until: hm(s.safety.until),
        fence: s.safety.fence,
        live: s.safety.live,
        alarm: s.safety.alarm,
      } satisfies Safety)
    }
  }
  emit()
}

export function useSafetyStore() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  return { trusted: loadTrusted(), safety: loadSafety(), enabled: SAFETY_PREVIEW || serverReady }
}

/** @katya_lviv → katya_lviv; +380… stays a phone */
export function cleanHandle(raw: string): { handle: string; error?: string } {
  const s = raw.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '')
  if (!s) return { handle: '', error: 'Впиши нік у Telegram, наприклад @katya_lviv' }
  if (/^\+?\d[\d\s-]{8,}$/.test(s)) return { handle: '+' + s.replace(/\D/g, '') }
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) return { handle: '', error: 'Такого ніку в Telegram не буває. Перевір, будь ласка.' }
  return { handle: s.toLowerCase() }
}

const NAMES: Record<string, string> = { katya_lviv: 'Катя', mama_olena: 'Олена' }

const ERRORS: Record<string, string> = {
  bad_handle: 'Такого ніку в Telegram не буває. Перевір, будь ласка.',
  exists: 'Цю людину вже додано',
  too_many: 'Не більше трьох людей',
  not_found_phone: 'За цим номером нікого не знайшли: людина могла сховати номер. Спитай її нік.',
  not_ready: 'Ця функція ще налаштовується. Спробуй трохи пізніше.',
}

export async function addTrusted(raw: string, onAgreed: (name: string) => void): Promise<string | null> {
  const { handle, error } = cleanHandle(raw)
  if (error) return error
  const list = loadTrusted()
  if (list.some((t) => t.handle === handle)) return 'Цю людину вже додано'
  if (list.length >= 3) return 'Не більше трьох людей'
  if (isLive()) {
    const r = await addTrustedApi(handle).catch(() => ({ ok: false, error: 'network' }) as { ok: boolean; error?: string; list?: Trusted[] })
    if (r.ok && r.list) {
      write(TRUSTED_KEY, r.list)
      return null
    }
    if (r.error === 'not_found') return `Не знайшли @${handle} у Telegram. Перевір нік.`
    return ERRORS[r.error ?? ''] ?? 'Не вдалося написати людині. Спробуй ще раз.'
  }
  // Prototype: a nick with "nobody" in it plays "not found"
  if (handle.includes('nobody')) {
    return handle.startsWith('+')
      ? 'За цим номером нікого не знайшли: людина могла сховати номер. Спитай її нік.'
      : `Не знайшли @${handle} у Telegram. Перевір нік.`
  }
  const name = NAMES[handle] ?? (handle.startsWith('+') ? handle : '@' + handle)
  write(TRUSTED_KEY, [...list, { handle, name, status: 'wait' }])
  // Prototype: the person answers «+» a few seconds later
  window.setTimeout(() => {
    const now = loadTrusted()
    if (!now.some((t) => t.handle === handle)) return
    write(
      TRUSTED_KEY,
      now.map((t) => (t.handle === handle ? { ...t, status: 'ok' as const } : t)),
    )
    onAgreed(name)
  }, 4000)
  return null
}

export function removeTrusted(handle: string) {
  if (isLive()) removeTrustedApi(handle).catch(() => {})
  write(
    TRUSTED_KEY,
    loadTrusted().filter((t) => t.handle !== handle),
  )
}

/** Meeting details the trusted people will see */
export type MeetingInfo = {
  time: string
  place: string
  address?: string
  lat?: number
  lon?: number
  withName?: string
  withAge?: number
}

export async function startSafety(s: Safety, m: MeetingInfo): Promise<string | null> {
  if (isLive()) {
    const r = await startSafetyApi({ ...m, matchId: s.matchId, guardians: s.guardians, checkAt: s.checkAt, fence: s.fence }).catch(
      () => ({ ok: false, error: 'network' }),
    )
    if (!r.ok) return r.error === 'not_ready' ? ERRORS.not_ready : 'Не вдалося увімкнути. Спробуй ще раз.'
  }
  write(SAFETY_KEY, s)
  return null
}

/** Last step: share live location with the bot. Real site opens the bot; the demo pretends. */
export function setLive(): boolean {
  const link = botStartLink('safe')
  if (isLive() && link) {
    window.open(link, '_blank', 'noopener')
    return false
  }
  const s = loadSafety()
  if (s) write(SAFETY_KEY, { ...s, live: true })
  return true
}
export function stopSafety() {
  if (isLive()) stopSafetyApi().catch(() => {})
  write(SAFETY_KEY, null)
}

export const guardianNames = (s: Safety, list = loadTrusted()) =>
  s.guardians.map((h) => list.find((t) => t.handle === h)?.name ?? h).join(', ')

/* ---------- Profile section ---------- */

export function TrustedSection({ onAgreed }: { onAgreed: (name: string) => void }) {
  const { trusted } = useSafetyStore()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (busy) return
    setBusy(true)
    const err = await addTrusted(value, onAgreed)
    setBusy(false)
    setError(err)
    if (!err) setValue('')
  }
  // Real site: check for «+» while someone is still deciding
  const waiting = trusted.filter((t) => t.status === 'wait').map((t) => t.handle).join(',')
  useEffect(() => {
    if (!isLive() || !waiting) return
    const before = new Map(loadTrusted().map((t) => [t.handle, t.status]))
    const id = window.setInterval(async () => {
      await syncSafety()
      for (const t of loadTrusted()) if (before.get(t.handle) === 'wait' && t.status === 'ok') onAgreed(t.name)
    }, 6000)
    return () => window.clearInterval(id)
  }, [waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="dlabel">
        Довірені люди <span className="dopt">до 3</span>
      </p>
      <p className="dhint dhint-left">
        Напишемо їм у Telegram, якщо під час зустрічі ти не відповіси або зникнеш зі зв’язку. Спершу кожен має
        погодитися.
      </p>
      {trusted.map((t) => (
        <div className="my-place" key={t.handle}>
          <span className="trusted-who">
            <b>{t.name}</b>
            {t.name !== '@' + t.handle && <span>{t.handle.startsWith('+') ? t.handle : '@' + t.handle}</span>}
          </span>
          <span className={`tstatus tstatus-${t.status}`}>
            {t.status === 'ok' ? '✓ підтверджено' : t.status === 'no' ? 'відмова' : 'чекаємо «+»'}
          </span>
          <button className="dlink" onClick={() => removeTrusted(t.handle)} aria-label={`Прибрати ${t.name}`}>
            ✕
          </button>
        </div>
      ))}
      {trusted.length < 3 && (
        <div className="trusted-add">
          <input
            className="dinput"
            placeholder="@нік або номер у Telegram"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            aria-label="Нік або номер у Telegram"
          />
          <button className="dchip on" onClick={add} disabled={busy}>
            {busy ? 'Пишемо…' : 'Додати'}
          </button>
        </div>
      )}
      {error && <p className="derror">{error}</p>}
    </>
  )
}

/* ---------- Meeting: turn it on ---------- */

const plus = (time: string, min: number) => {
  const [h, m] = time.split(':').map(Number)
  const t = h * 60 + m + min
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function SafetySetup({
  matchId,
  time,
  meeting,
  onDone,
  onProfile,
}: {
  matchId: string
  /** Meeting time, "19:00" */
  time: string
  meeting: MeetingInfo
  onDone: (s: Safety) => void
  onProfile: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { trusted } = useSafetyStore()
  const agreed = trusted.filter((t) => t.status === 'ok')
  const [picked, setPicked] = useState<string[]>(agreed.map((t) => t.handle))
  const options = [60, 120, 150].map((m) => plus(time, m))
  const [checkAt, setCheckAt] = useState(options[1])
  const [fence, setFence] = useState(true)

  if (agreed.length === 0)
    return (
      <>
        <p className="dtext">
          Спершу додай довірену людину в профілі. Ми напишемо їй у Telegram, і вона має відповісти «+».
        </p>
        {trusted.length > 0 && <p className="dhint dhint-left">Чекаємо відповіді від: {trusted.map((t) => t.name).join(', ')}</p>}
        <button className="dbtn" onClick={onProfile}>
          Додати в профілі
        </button>
      </>
    )

  return (
    <>
      <p className="dtext dsmall">Діє 3 години, потім вимкнеться сама. Довірена людина побачить місце, час, з ким ти і де ти зараз.</p>
      <p className="dlabel">Хто знатиме</p>
      <div className="dchips">
        {agreed.map((t) => (
          <button
            key={t.handle}
            className={picked.includes(t.handle) ? 'dchip on' : 'dchip'}
            aria-pressed={picked.includes(t.handle)}
            onClick={() => setPicked((p) => (p.includes(t.handle) ? p.filter((x) => x !== t.handle) : [...p, t.handle]))}
          >
            {t.name}
          </button>
        ))}
      </div>
      <p className="dlabel">Коли спитати «Все добре?»</p>
      <div className="dchips" role="radiogroup">
        {options.map((o) => (
          <button key={o} role="radio" aria-checked={checkAt === o} className={checkAt === o ? 'dchip on' : 'dchip'} onClick={() => setCheckAt(o)}>
            о {o}
          </button>
        ))}
      </div>
      <button className={fence ? 'dtoggle on' : 'dtoggle'} role="switch" aria-checked={fence} onClick={() => setFence(!fence)}>
        <span className="dtoggle-text">
          <b>Якщо я піду далі 1 км</b>
          <span>Бот спитає, чи все гаразд. Не відповіш за 5 хвилин — напишемо довіреній людині.</span>
        </span>
        <span className="dtoggle-knob" aria-hidden="true" />
      </button>
      {err && <p className="derror">{err}</p>}
      <button
        className="dbtn"
        disabled={picked.length === 0 || busy}
        onClick={async () => {
          const s: Safety = { matchId, guardians: picked, checkAt, until: plus(time, 180), fence, live: false }
          setBusy(true)
          const e = await startSafety(s, meeting)
          setBusy(false)
          if (e) return setErr(e)
          onDone(s)
        }}
      >
        {busy ? 'Вмикаємо…' : 'Увімкнути'}
      </button>
    </>
  )
}
