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
 * Server side (sending from the account, «+» replies, timers, /safe page)
 * comes next; here the «+» is simulated so the flow can be tried.
 */
import { useEffect, useState } from 'react'

/** Not public yet: on with ?safety=1 (remembered), off with ?safety=0 */
export const SAFETY_PREVIEW = (() => {
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

export function useSafetyStore() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  return { trusted: loadTrusted(), safety: loadSafety() }
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

export function addTrusted(raw: string, onAgreed: (name: string) => void): string | null {
  const { handle, error } = cleanHandle(raw)
  if (error) return error
  const list = loadTrusted()
  if (list.some((t) => t.handle === handle)) return 'Цю людину вже додано'
  if (list.length >= 3) return 'Не більше трьох людей'
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
  write(
    TRUSTED_KEY,
    loadTrusted().filter((t) => t.handle !== handle),
  )
}

export function startSafety(s: Safety) {
  write(SAFETY_KEY, s)
}
export function setLive() {
  const s = loadSafety()
  if (s) write(SAFETY_KEY, { ...s, live: true })
}
export function stopSafety() {
  write(SAFETY_KEY, null)
}

export const guardianNames = (s: Safety, list = loadTrusted()) =>
  s.guardians.map((h) => list.find((t) => t.handle === h)?.name ?? h).join(', ')

/* ---------- Profile section ---------- */

export function TrustedSection({ onAgreed }: { onAgreed: (name: string) => void }) {
  const { trusted } = useSafetyStore()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = () => {
    const err = addTrusted(value, onAgreed)
    setError(err)
    if (!err) setValue('')
  }
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
          <button className="dchip on" onClick={add}>
            Додати
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
  onDone,
  onProfile,
}: {
  matchId: string
  /** Meeting time, "19:00" */
  time: string
  onDone: (s: Safety) => void
  onProfile: () => void
}) {
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
      <button
        className="dbtn"
        disabled={picked.length === 0}
        onClick={() => onDone({ matchId, guardians: picked, checkAt, until: plus(time, 180), fence, live: false })}
      >
        Увімкнути
      </button>
    </>
  )
}
