import { useEffect, useRef, useState } from 'react'
import { CITY, CITY_NAME, TAGS } from './feed'
import selfie from './site/img/selfie.jpg'
import type { Profile } from './profile'
import {
  miniAppLink,
  prepareBotLogin,
  telegramEnabled,
  telegramLogin,
  botFromCode,
  waitForBotLogin,
  type BotLogin,
  type TgUser,
} from './telegram'
import { identify, track } from './track'
import { Sticker } from './ui'
import { fetchMe, isLive } from './live'
import { savePrefs, syncSafety, TrustedSection, useSafetyStore } from './safety'

function TelegramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.7 13l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z"
      />
    </svg>
  )
}

const RULES = [
  { title: 'Без анкет і свайпів', text: 'Пишеш, що хочеш сьогодні. Решту робить стрічка.' },
  { title: 'Тільки публічні місця', text: 'Кав’ярні, бари, парки. Ніяких «приходь до мене».' },
  { title: 'Ім’я — після «Так»', text: 'До матчу ніхто не бачить твоє ім’я і фото.' },
]

export function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [loading, setLoading] = useState(false)
  // Bot sign-in: code is registered up front so the click can open Telegram synchronously.
  const [bot, setBot] = useState<BotLogin | null>(null)
  const [waiting, setWaiting] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const [expired, setExpired] = useState(false)
  const tgLink = miniAppLink(CITY)

  useEffect(() => {
    track('landing_view')
    const params = new URLSearchParams(location.search)
    const fromSite = params.get('login')
    if (fromSite && /^[a-f0-9]{32}$/.test(fromSite)) {
      // Came from the site's button: Telegram is already open, just wait for Start.
      params.delete('login')
      history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash)
      const b = botFromCode(fromSite)
      if (b) {
        setBot(b)
        startWaiting(b)
      }
    } else if (telegramEnabled) {
      // Real site: the landing page is the start screen; /app without a login code goes back there.
      location.replace(`./${location.hash}`)
    } else {
      // Demo build (no bot, e.g. a test deployment): no start screen, straight in as a guest
      telegramLogin().then((u) => done(u, "demo"))
    }
    return () => abort.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const done = (user: TgUser, via: string) => {
    if (telegramEnabled) identify(String(user.id), { username: user.username, first_name: user.first_name })
    track('login_success', { real: telegramEnabled, via })
    onSignedIn()
  }

  const startWaiting = (b: BotLogin) => {
    setWaiting(true)
    abort.current = new AbortController()
    waitForBotLogin(b.code, abort.current.signal)
      .then((user) => done(user, 'bot'))
      .catch((e) => {
        if (e instanceof Error && e.message === 'aborted') return
        track('login_error', { reason: e instanceof Error ? e.message : 'unknown', via: 'bot' })
        setWaiting(false)
        if (telegramEnabled) setExpired(true)
        else prepareBotLogin().then(setBot)
      })
  }

  const signInWithBot = () => {
    if (!bot) return
    track('login_start', { from: 'landing', via: 'bot' })
    window.open(bot.link, '_blank', 'noopener')
    if (!waiting) startWaiting(bot)
  }

  const signIn = async () => {
    track('login_start', { from: 'landing', via: 'widget' })
    setLoading(true)
    try {
      done(await telegramLogin(), 'widget')
    } catch (e) {
      track('login_error', { reason: e instanceof Error ? e.message : 'unknown', via: 'widget' })
      setLoading(false)
    }
  }

  if (!telegramEnabled)
    return (
      <div className="screen connecting" aria-busy="true">
        <span className="btn-spinner" aria-hidden="true" />
        <span>Відкриваємо демо…</span>
      </div>
    )

  // Real site: a plain waiting screen, the marketing lives on the landing page.
  if (telegramEnabled) {
    return (
      <div className="screen wait-screen">
        <span className="wordmark">today</span>
        <div className="wait-screen-body" aria-live="polite">
          {expired ? (
            <>
              <h1>Посилання для входу застаріло</h1>
              <p>Таке буває, якщо не натиснути Start за 10 хвилин. Спробуй ще раз з головної.</p>
              <a className="dbtn tg-btn" href={`./${location.hash}`}>
                На головну
              </a>
            </>
          ) : (
            <>
              <span className="btn-spinner wait-screen-spinner" aria-hidden="true" />
              <h1>Натисни Start у Telegram</h1>
              <p>Ми відкрили бота today. Натисни там «Почати» і повертайся сюди: вхід відбудеться сам.</p>
              {bot && (
                <a className="dbtn tg-btn" href={bot.link} target="_blank" rel="noopener">
                  <TelegramIcon /> Відкрити Telegram ще раз
                </a>
              )}
              <a className="wait-screen-back" href={`./${location.hash}`}>
                Повернутися на сайт
              </a>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="screen landing start">
      <div className="start-hero">
        <img className="start-img" src={selfie} alt="Друзі роблять селфі в парку" />
        <div className="start-shade" aria-hidden="true" />
        <div className="start-head">
          <span className="wordmark start-word">today</span>
          <span className="proto-tag">прототип, {CITY_NAME}</span>
        </div>
      </div>

      <main className="landing-main start-main">
        <Sticker
          as="h1"
          size="lg"
          lines={[
            { text: 'менше чатів', tag: 'Ігри' },
            { text: 'більше вечорів', tag: 'Кава' },
          ]}
        />
        <p className="landing-lead">
          Компанія на сьогодні: кава, кіно, боулінг чи прогулянка з людьми поруч.
        </p>

        <ul className="landing-rules">
          {RULES.map((r) => (
            <li key={r.title}>
              <span className="landing-rule-dot" aria-hidden="true" />
              <div>
                <p className="landing-rule-title">{r.title}</p>
                <p className="landing-rule-text">{r.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <div className="landing-cta">
        {bot ? (
          <>
            <button className="dbtn tg-btn" onClick={signInWithBot} aria-busy={waiting}>
              {waiting ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" /> Чекаємо на Start у Telegram…
                </>
              ) : (
                <>
                  <TelegramIcon /> Увійти через Telegram
                </>
              )}
            </button>
            <p className="landing-fine" aria-live="polite">
              {waiting ? (
                <>
                  Натисни Start у боті й повертайся сюди.{' '}
                  <button className="link-btn" onClick={signInWithBot}>
                    Відкрити Telegram ще раз
                  </button>
                </>
              ) : (
                'Без пароля і номера телефону: один тап у Telegram.'
              )}
            </p>
          </>
        ) : tgLink ? (
          <>
            <a className="dbtn tg-btn" href={tgLink} onClick={() => track('login_start', { from: 'landing', via: 'mini_app' })}>
              <TelegramIcon /> Відкрити в Telegram
            </a>
            <p className="landing-fine">
              Відкриється прямо в Telegram, вхід автоматичний.{' '}
              <button className="link-btn" onClick={signIn} disabled={loading}>
                {loading ? 'Підключаємо…' : 'Або увійти тут, у браузері'}
              </button>
            </p>
          </>
        ) : (
          <>
            <button className="dbtn tg-btn" onClick={signIn} disabled={loading} aria-busy={loading}>
              {loading ? (
                <>
                  <span className="btn-spinner" aria-hidden="true" /> Підключаємо Telegram…
                </>
              ) : (
                <>
                  <TelegramIcon /> Увійти через Telegram
                </>
              )}
            </button>
            <p className="landing-fine">
              Без пароля і номера телефону. Писатимемо тільки про запрошення й плани поруч.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const WHEN: { key: 'weekday' | 'weekend'; label: string }[] = [
  { key: 'weekday', label: 'Будні ввечері' },
  { key: 'weekend', label: 'Вихідні' },
]
const COMPANY: { key: 'one' | 'group' | 'any'; label: string }[] = [
  { key: 'one', label: 'Удвох' },
  { key: 'group', label: 'Компанією' },
  { key: 'any', label: 'Без різниці' },
]

/**
 * Three short steps in the site's look:
 * 1 about me (+ gender/age only when Telegram didn't tell us),
 * 2 what I'm into (the feed and pings use it),
 * 3 Safety mode (skippable).
 */
export function Onboarding({
  profile,
  genderKnown,
  onDone,
}: {
  profile: Profile
  /** Gender came from the person, not our guess by name */
  genderKnown?: boolean
  onDone: (p: Profile) => void
}) {
  const { enabled: safetyOn, trusted, prefs } = useSafetyStore()
  const steps = safetyOn ? 3 : 2
  const [step, setStep] = useState(1)
  const [bio, setBio] = useState(profile.bio)
  const [ga, setGa] = useState<Pick<Profile, 'gender' | 'age'>>({ gender: profile.gender, age: profile.age })
  const [askGa] = useState(() => !genderKnown || !profile.age)
  const [interests, setInterests] = useState<string[]>(profile.interests ?? [])
  const [when, setWhen] = useState<('weekday' | 'weekend')[]>(profile.when ?? [])
  const [company, setCompany] = useState<'one' | 'group' | 'any'>(profile.company ?? 'any')

  // Age from the Telegram birthday, if they set one with a year and it's visible to the bot.
  useEffect(() => {
    syncSafety()
    if (profile.age || !isLive()) return
    fetchMe().then(({ age }) => {
      if (age) setGa((cur) => (cur.age ? cur : { ...cur, age }))
      track('age_hint', { found: Boolean(age) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    track('onboarding_step', { step })
    window.scrollTo(0, 0)
  }, [step])

  const finish = () => {
    track('onboarding_done', {
      hasBio: Boolean(bio.trim()),
      gender: ga.gender ?? 'none',
      interests: interests.length,
      safety: prefs.on,
      trusted: trusted.length,
    })
    onDone({ ...profile, bio: bio.trim(), areas: profile.areas ?? [], ...ga, interests, when, company })
  }
  const next = () => (step < steps ? setStep(step + 1) : finish())
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const who = [ga.gender, ga.age ? String(ga.age) : ''].filter(Boolean).join(', ')

  return (
    <div className="ob">
      <header className="ob-head">
        {step > 1 ? (
          <button className="ob-back" onClick={() => setStep(step - 1)} aria-label="Назад">
            ‹
          </button>
        ) : (
          <span className="ob-logo">today</span>
        )}
        <div className="ob-progress" aria-label={`Крок ${step} з ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={i < step ? 'on' : ''} />
          ))}
        </div>
        {step > 1 ? (
          <button className="ob-skip" onClick={next}>
            Пропустити
          </button>
        ) : (
          <span className="ob-skip-space" />
        )}
      </header>

      <main className="ob-main">
        {step === 1 && (
          <>
            <Sticker
              as="h1"
              lines={[
                { text: 'пару слів', tag: 'Прогулянка' },
                { text: 'про тебе', tag: 'Спорт' },
              ]}
            />
            <p className="ob-lead">Це побачать на твоїх постах. Ім’я та фото з Telegram — тільки після матчу.</p>
            <label className="ob-label" htmlFor="o-bio">
              Про себе
            </label>
            <textarea
              id="o-bio"
              className="ob-input"
              rows={3}
              maxLength={80}
              placeholder="Чим займаєшся, що любиш"
              value={bio}
              onChange={(e) => setBio(e.target.value.replace(/\s*\n\s*/g, ' '))}
            />
            {askGa && (
              <>
                <p className="ob-label">Стать</p>
                <div className="ob-gender" role="radiogroup" aria-label="Стать">
                  {(['Чоловік', 'Жінка'] as const).map((g) => (
                    <button
                      key={g}
                      role="radio"
                      aria-checked={ga.gender === g}
                      className={ga.gender === g ? 'ob-chip on' : 'ob-chip'}
                      onClick={() => setGa({ ...ga, gender: g })}
                    >
                      {g}
                    </button>
                  ))}
                  <button
                    role="radio"
                    aria-checked={!ga.gender}
                    className={!ga.gender ? 'ob-chip ob-chip-wide on' : 'ob-chip ob-chip-wide'}
                    onClick={() => setGa({ ...ga, gender: undefined })}
                  >
                    Не вказувати
                  </button>
                </div>
                <label className="ob-label" htmlFor="o-age">
                  Вік
                </label>
                <input
                  id="o-age"
                  className="ob-input ob-age"
                  inputMode="numeric"
                  maxLength={2}
                  placeholder="Наприклад, 27"
                  value={ga.age ?? ''}
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                    setGa({ ...ga, age: Number.isFinite(n) ? n : undefined })
                  }}
                />
              </>
            )}
            <div className="ob-preview" aria-label="Так тебе бачитимуть">
              <span className="ob-preview-kicker">Так тебе бачитимуть</span>
              <b>{who || 'Без статі й віку'}</b>
              <span>{bio.trim() || 'Тут буде твій рядок «про себе»'}</span>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Sticker
              as="h1"
              lines={[
                { text: 'що', tag: 'Кава' },
                { text: 'шукаєш', tag: 'Кіно' },
              ]}
            />
            <p className="ob-lead">Покажемо такі плани першими й напишемо, коли щось схоже з’явиться поруч.</p>
            <p className="ob-label">Як любиш проводити час</p>
            <div className="ob-chips">
              {TAGS.map((t) => (
                <button
                  key={t}
                  className={interests.includes(t) ? 'ob-chip on' : 'ob-chip'}
                  aria-pressed={interests.includes(t)}
                  onClick={() => setInterests(toggle(interests, t))}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="ob-label">Коли зазвичай вільний(а)</p>
            <div className="ob-chips">
              {WHEN.map((w) => (
                <button
                  key={w.key}
                  className={when.includes(w.key) ? 'ob-chip on' : 'ob-chip'}
                  aria-pressed={when.includes(w.key)}
                  onClick={() => setWhen(toggle(when, w.key))}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <p className="ob-label">З ким комфортніше</p>
            <div className="ob-chips" role="radiogroup">
              {COMPANY.map((c) => (
                <button
                  key={c.key}
                  role="radio"
                  aria-checked={company === c.key}
                  className={company === c.key ? 'ob-chip on' : 'ob-chip'}
                  onClick={() => setCompany(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Sticker
              as="h1"
              lines={[
                { text: 'спокійно', tag: 'Прогулянка' },
                { text: 'на зустрічі', tag: 'Кава' },
              ]}
            />
            <p className="ob-lead">
              Safety mode: за 10 хвилин до зустрічі довірені люди дізнаються, де й з ким ти. Бот спитає «Все добре?», а
              якщо не відповіси — напише їм.
            </p>
            <div className="ob-safety">
              <TrustedSection />
            </div>
            <button
              className={prefs.on ? 'ob-toggle on' : 'ob-toggle'}
              role="switch"
              aria-checked={prefs.on}
              disabled={!trusted.length && !prefs.on}
              onClick={() => savePrefs({ ...prefs, on: !prefs.on })}
            >
              <span>
                <b>Увімкнути для всіх зустрічей</b>
                <span>{trusted.length ? 'Можна змінити будь-коли: щит угорі стрічки' : 'Спершу додай людину вище'}</span>
              </span>
              <span className="ob-knob" aria-hidden="true" />
            </button>
          </>
        )}
      </main>

      <div className="ob-cta">
        <button className="ob-btn" onClick={next}>
          {step < steps ? 'Далі' : 'Готово'}
        </button>
      </div>
    </div>
  )
}
