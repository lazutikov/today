import { useEffect, useState } from 'react'
import { CITY_NAME, MAX_AREAS } from './feed'
import selfie from './site/img/selfie.jpg'
import type { Profile } from './profile'
import { miniAppLink, telegramEnabled, telegramLogin } from './telegram'
import { CITY } from './feed'
import { identify, track } from './track'
import { AreaPicker, GenderAge, Sticker } from './ui'

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
  const tgLink = miniAppLink(CITY)

  useEffect(() => {
    track('landing_view')
  }, [])

  const signIn = async () => {
    track('login_start', { from: 'landing', via: 'widget' })
    setLoading(true)
    try {
      const user = await telegramLogin()
      if (telegramEnabled) identify(String(user.id), { username: user.username, first_name: user.first_name })
      track('login_success', { real: telegramEnabled })
      onSignedIn()
    } catch (e) {
      track('login_error', { reason: e instanceof Error ? e.message : 'unknown' })
      setLoading(false)
    }
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
        {tgLink ? (
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

export function Onboarding({
  profile,
  onDone,
}: {
  profile: Profile
  onDone: (p: Profile) => void
}) {
  const [bio, setBio] = useState(profile.bio)
  const [areas, setAreas] = useState<string[]>(profile.areas ?? [])
  const [ga, setGa] = useState<Pick<Profile, 'gender' | 'age'>>({
    gender: profile.gender,
    age: profile.age,
  })
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (areas.length === 0) return setError('Обери хоча б один район, щоб бачити людей поруч')
    track('onboarding_done', { hasBio: Boolean(bio.trim()), areas, gender: ga.gender ?? 'none' })
    onDone({ bio: bio.trim(), areas, ...ga })
  }

  return (
    <div className="screen landing">
      <header className="screen-head">
        <div className="wordmark">today</div>
      </header>
      <main className="landing-main">
        <Sticker
          as="h1"
          lines={[
            { text: 'ще один', tag: 'Прогулянка' },
            { text: 'крок', tag: 'Спорт' },
          ]}
        />
        <p className="landing-lead">
          Це бачитимуть на твоїх постах. Ім’я та фото з Telegram — тільки після матчу.
        </p>

        <label className="dlabel" htmlFor="o-bio">
          Про себе <span className="dopt">необов’язково</span>
        </label>
        <input
          id="o-bio"
          className="dinput dinput-white"
          maxLength={80}
          placeholder="Одним рядком: чим займаєшся, що любиш"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />

        <p className="dlabel">
          Де тобі зручно зустрічатися? <span className="dopt">до {MAX_AREAS}</span>
        </p>
        <AreaPicker value={areas} multi onChange={setAreas} onError={setError} />

        <p className="dlabel">
          Стать і вік <span className="dopt">необов’язково, видно на твоїх постах</span>
        </p>
        <GenderAge gender={ga.gender} age={ga.age} onChange={setGa} />

        {error && (
          <p className="derror" role="alert">
            {error}
          </p>
        )}
      </main>
      <div className="landing-cta">
        <button className="dbtn" onClick={submit}>
          Готово
        </button>
      </div>
    </div>
  )
}
