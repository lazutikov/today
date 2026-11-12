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

/** handle = invite id; name = who they are in Telegram, once they agreed */
export type Trusted = { handle: string; name: string; status: 'wait' | 'ok' | 'no'; label?: string; link?: string }
export type Safety = {
  matchId: string
  guardians: string[] // invite ids
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

/* ---------- Safety mode settings ---------- */

export type SafetyPrefs = {
  /** On: every match gets the safety net automatically */
  on: boolean
  /** Ask «Все добре?» this many minutes after the meeting starts */
  checkAfter: number
  /** "Away" distance from the venue, km; 0 = don't watch */
  fenceKm: number
  /** Minutes to wait for an answer before writing to trusted people */
  answerMin: number
}
const PREFS_KEY = 'today.safetyPrefs'
const DEFAULT_PREFS: SafetyPrefs = { on: false, checkAfter: 120, fenceKm: 1, answerMin: 10 }
export const loadPrefs = (): SafetyPrefs => ({ ...DEFAULT_PREFS, ...read<Partial<SafetyPrefs>>(PREFS_KEY, {}) })
export const savePrefs = (p: SafetyPrefs) => write(PREFS_KEY, p)

const hoursText = (min: number) => (min % 60 ? `${Math.floor(min / 60)},5 год` : `${min / 60} год`)
export const fenceText = (km: number) => (km === 0 ? 'без зони' : km < 1 ? `${km * 1000} м` : `${km} км`)

/** «Мама, Катя · «Все добре?» через 2 год · зона 1 км» */
export function prefsSummary(p = loadPrefs(), list = loadTrusted()) {
  const who = list.filter((t) => t.status === 'ok').map((t) => t.label || t.name)
  return [
    who.length ? who.join(', ') : 'немає довірених людей',
    `«Все добре?» через ${hoursText(p.checkAfter)}`,
    p.fenceKm ? `зона ${fenceText(p.fenceKm)}` : 'без зони',
  ].join(' · ')
}
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
  return { trusted: loadTrusted(), safety: loadSafety(), prefs: loadPrefs(), enabled: SAFETY_PREVIEW || serverReady }
}

/** @katya_lviv → katya_lviv; +380… stays a phone */
export function cleanHandle(raw: string): { handle: string; error?: string } {
  const s = raw.trim().replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '')
  if (!s) return { handle: '', error: 'Впиши нік у Telegram, наприклад @katya_lviv' }
  if (/^\+?\d[\d\s-]{8,}$/.test(s)) return { handle: '+' + s.replace(/\D/g, '') }
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) return { handle: '', error: 'Такого ніку в Telegram не буває. Перевір, будь ласка.' }
  return { handle: s.toLowerCase() }
}


const ERRORS: Record<string, string> = {
  no_label: 'Напиши, як підписати людину, наприклад «Мама»',
  too_many: 'Не більше трьох людей',
}

const INVITE_TEXT = 'Додаю тебе довіреною людиною в today: якщо під час зустрічі я не відповідатиму, бот напише тобі. Відкрий посилання і натисни «Так»:'

/** Send the invite link the way the phone shares things; Telegram's share page elsewhere */
export async function shareInvite(link: string) {
  try {
    if (navigator.share) {
      await navigator.share({ text: INVITE_TEXT, url: link })
      return
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
  }
  window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(INVITE_TEXT)}`, '_blank', 'noopener')
}

/** A new trusted person: make an invite and share it. Returns an error text or null. */
export async function addTrusted(rawLabel: string, onAgreed: (name: string) => void): Promise<string | null> {
  const label = rawLabel.trim()
  if (!label) return ERRORS.no_label
  const list = loadTrusted()
  if (list.filter((t) => t.status !== 'no').length >= 3) return ERRORS.too_many
  if (isLive()) {
    const r = await addTrustedApi(label).catch(() => ({ ok: false, error: 'network' }) as { ok: boolean; error?: string; list?: Trusted[]; link?: string })
    if (r.ok && r.list) {
      // Sharing needs a fresh tap (phones block it after a network wait): the row shows the button
      write(TRUSTED_KEY, r.list)
      return null
    }
    return ERRORS[r.error ?? ''] ?? 'Не вдалося створити запрошення. Спробуй ще раз.'
  }
  // Demo: the person opens the link and says «Так» a few seconds later
  const handle = `demo${Date.now().toString(36)}`
  write(TRUSTED_KEY, [...list, { handle, name: '', label, status: 'wait', link: 'https://t.me/today_bot?start=tr_demo' }])
  window.setTimeout(() => {
    const now = loadTrusted()
    if (!now.some((t) => t.handle === handle)) return
    write(
      TRUSTED_KEY,
      now.map((t) => (t.handle === handle ? { ...t, status: 'ok' as const, name: 'Катя · @katya_lviv' } : t)),
    )
    onAgreed(label)
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

/** Turn the safety net on for one match with the Safety mode settings */
export async function startForMatch(matchId: string, m: MeetingInfo): Promise<string | null> {
  const p = loadPrefs()
  const guardians = loadTrusted().filter((t) => t.status === 'ok').map((t) => t.handle)
  if (!guardians.length) return 'Спершу додай довірену людину в Safety mode'
  const s: Safety = {
    matchId,
    guardians,
    checkAt: plus(m.time, p.checkAfter),
    until: plus(m.time, 180),
    fence: p.fenceKm > 0,
    live: false,
  }
  return startSafety(s, m, p)
}

export async function startSafety(s: Safety, m: MeetingInfo, p = loadPrefs()): Promise<string | null> {
  if (isLive()) {
    const r = await startSafetyApi({ ...m, matchId: s.matchId, guardians: s.guardians, checkAt: s.checkAt, fence: s.fence, fenceKm: p.fenceKm, answerMin: p.answerMin }).catch(
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

const shown = (t: Trusted) => t.label || t.name

export const guardianNames = (s: Safety, list = loadTrusted()) =>
  s.guardians.map((h) => {
    const t = list.find((x) => x.handle === h)
    return t ? shown(t) : h
  }).join(', ')

/* ---------- Profile section ---------- */

export function TrustedSection({ onAgreed }: { onAgreed: (name: string) => void }) {
  const { trusted } = useSafetyStore()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = trusted.filter((t) => t.status !== 'no')
  const add = async () => {
    if (busy) return
    setBusy(true)
    const err = await addTrusted(label, onAgreed)
    setBusy(false)
    setError(err)
    if (!err) setLabel('')
  }
  // Real site: notice when someone says «Так» in the bot
  const waiting = trusted.filter((t) => t.status === 'wait').map((t) => t.handle).join(',')
  useEffect(() => {
    if (!isLive() || !waiting) return
    const before = new Map(loadTrusted().map((t) => [t.handle, t.status]))
    const id = window.setInterval(async () => {
      await syncSafety()
      for (const t of loadTrusted()) if (before.get(t.handle) === 'wait' && t.status === 'ok') onAgreed(shown(t))
    }, 5000)
    return () => window.clearInterval(id)
  }, [waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="dlabel">
        Довірені люди <span className="dopt">до 3</span>
      </p>
      <p className="dhint dhint-left">
        Бот today напише їм у Telegram, якщо під час зустрічі ти не відповіси або зникнеш зі зв’язку. Надішли
        людині запрошення — вона відкриє його і натисне «Так».
      </p>
      {trusted.map((t) => (
        <div className="my-place" key={t.handle}>
          <span className="trusted-who">
            <b>{shown(t)}</b>
            {t.status === 'ok' && t.name && <span>{t.name}</span>}
            {t.status === 'wait' && t.link && (
              <button className="dchip on trusted-send" onClick={() => shareInvite(t.link!)}>
                Надіслати запрошення
              </button>
            )}
          </span>
          <span className={`tstatus tstatus-${t.status}`}>
            {t.status === 'ok' ? '✓ погодились' : t.status === 'no' ? 'відмова' : 'чекаємо'}
          </span>
          <button className="dlink" onClick={() => removeTrusted(t.handle)} aria-label={`Прибрати ${shown(t)}`}>
            ✕
          </button>
        </div>
      ))}
      {active.length < 3 && (
        <div className="trusted-add">
          <input
            className="dinput"
            placeholder="Хто це? Напр. «Мама»"
            maxLength={30}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            aria-label="Як підписати людину"
          />
          <button className="dchip on" onClick={add} disabled={busy}>
            {busy ? '…' : 'Запросити'}
          </button>
        </div>
      )}
      {error && <p className="derror">{error}</p>}
    </>
  )
}

/* ---------- Meeting: turn it on ---------- */

function plus(time: string, min: number) {
  const [h, m] = (/^\d{1,2}:\d{2}/.test(time) ? time : '19:00').split(':').map(Number)
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
        {trusted.length > 0 && <p className="dhint dhint-left">Чекаємо відповіді від: {trusted.map(shown).join(', ')}</p>}
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
            {shown(t)}
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

/* ---------- Safety mode page ---------- */

function Chips<T extends number>({ value, options, label, onChange }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="dchips" role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'dchip on' : 'dchip'} onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
}

export function SafetySettings({ onAgreed }: { onAgreed: (name: string) => void }) {
  const { prefs, trusted } = useSafetyStore()
  const agreed = trusted.filter((t) => t.status === 'ok').length
  const set = (patch: Partial<SafetyPrefs>) => savePrefs({ ...prefs, ...patch })
  return (
    <>
      <div className={prefs.on ? 'safety-state on' : 'safety-state'}>
        <b>{prefs.on ? '● Safety mode увімкнено' : 'Safety mode вимкнено'}</b>
        <span>
          Кожен твій матч отримує підстраховку: довірені люди знають, де ти, а бот питає «Все добре?». Не
          відповіси — бот напише їм, де ти була востаннє.
        </span>
      </div>
      {prefs.on ? (
        <button className="dbtn dbtn-ghost" onClick={() => set({ on: false })}>
          Вимкнути Safety mode
        </button>
      ) : (
        <button className="dbtn" disabled={!agreed} onClick={() => set({ on: true })}>
          Увімкнути Safety mode
        </button>
      )}
      {!agreed && <p className="dhint">Щоб увімкнути, додай хоча б одну довірену людину нижче.</p>}

      <TrustedSection onAgreed={onAgreed} />

      <p className="dlabel">Коли спитати «Все добре?»</p>
      <Chips value={prefs.checkAfter} options={[60, 120, 150]} label={(v) => `через ${hoursText(v)}`} onChange={(v) => set({ checkAfter: v })} />
      <p className="dhint dhint-left">Від початку зустрічі. Можна відповісти «Спитай ще через годину».</p>

      <p className="dlabel">Якщо я піду далеко від місця</p>
      <Chips value={prefs.fenceKm} options={[0, 0.5, 1, 2]} label={(v) => (v ? `далі ${fenceText(v)}` : 'Не стежити')} onChange={(v) => set({ fenceKm: v })} />

      <p className="dlabel">Скільки чекати відповідь</p>
      <Chips value={prefs.answerMin} options={[5, 10, 15]} label={(v) => `${v} хв`} onChange={(v) => set({ answerMin: v })} />
      <p className="dhint dhint-left">Не відповіси за цей час — бот напише довіреним людям, де ти була востаннє.</p>

      <p className="dhint">У небезпеці — дзвони 112. Safety mode не замінює екстрені служби.</p>
    </>
  )
}
