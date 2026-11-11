import { useEffect, useState } from 'react'
import { ACTIVITIES, DISTRICTS } from './data'
import { EVENTS, PEOPLE, type FeedCard } from './feed'
import { track } from './track'
import Proto from './proto'
import { CardView, Dock, type Tab } from './ui'

export default function Root() {
  const soon = new URLSearchParams(location.search).get('mode') === 'soon'
  return soon ? <SoonApp /> : <Proto />
}

type Screen = 'feed' | 'survey' | 'done'

function SoonApp() {
  const [screen, setScreen] = useState<Screen>('feed')
  const [sheetFor, setSheetFor] = useState<FeedCard | 'create' | null>(null)

  useEffect(() => {
    track('feed_view')
  }, [])

  const openCard = (card: FeedCard) => {
    track('card_cta', { card: card.id, kind: card.kind })
    setSheetFor(card)
  }

  const openCreate = () => {
    track('card_cta', { card: 'create' })
    setSheetFor('create')
  }

  const startLogin = () => {
    track('login_start', { from: sheetFor === 'create' ? 'create' : sheetFor?.id })
    // TODO(stage 2): real Telegram Login Widget with request_access=write.
    setSheetFor(null)
    setScreen('survey')
  }

  return (
    <>
      {screen === 'feed' && <Feed onCard={openCard} onCreate={openCreate} />}
      {screen !== 'feed' && (
        <div className="app">
          {screen === 'survey' && <Survey onDone={() => setScreen('done')} />}
          {screen === 'done' && <Done />}
        </div>
      )}
      {sheetFor && (
        <Sheet target={sheetFor} onLogin={startLogin} onClose={() => setSheetFor(null)} />
      )}
    </>
  )
}

/* ---------- Feed ("soon" mode) ---------- */

function Feed({ onCard, onCreate }: { onCard: (c: FeedCard) => void; onCreate: () => void }) {
  const [tab, setTab] = useState<Tab>('people')
  const cards = tab === 'people' ? PEOPLE : EVENTS

  const switchTab = (next: Tab) => {
    if (next === tab) return
    track('tab_switch', { to: next })
    setTab(next)
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="wordmark">today</div>
      </header>
      <ul className="cards" id="feed-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {cards.map((card) => (
          <li key={card.id}>
            <CardView card={card} onOpen={() => onCard(card)} />
          </li>
        ))}
      </ul>
      <Dock tab={tab} onTab={switchTab} onCreate={onCreate} />
    </div>
  )
}

/* ---------- Sheet ---------- */

function Sheet({
  target,
  onLogin,
  onClose,
}: {
  target: FeedCard | 'create'
  onLogin: () => void
  onClose: () => void
}) {
  const what =
    target === 'create'
      ? 'Створювати плани можна буде в день запуску.'
      : 'Це був приклад картки.'
  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" aria-hidden="true" />
        <h2 id="sheet-title" className="h2">
          Ми ще не запустились
        </h2>
        <p className="muted">
          {what} today відкривається у Варшаві район за районом. Залиш заявку — і ми напишемо
          тобі в Telegram, щойно відкриємо твій.
        </p>
        <button className="btn btn-tg" onClick={onLogin}>
          <TgIcon /> Увійти через Telegram
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Пізніше
        </button>
        <p className="fine">Без анкет і паролів. Пишемо тільки про запуск і плани поруч.</p>
      </div>
    </div>
  )
}

function TgIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.7 13l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z"
      />
    </svg>
  )
}

/* ---------- Survey ---------- */

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']
const GENDERS = ['Жінка', 'Чоловік', 'Інше', 'Не скажу']
const AGES = ['18–24', '25–29', '30–35', '36+']

function Survey({ onDone }: { onDone: () => void }) {
  const [district, setDistrict] = useState<string | null>(null)
  const [acts, setActs] = useState<string[]>([])
  const [days, setDays] = useState<string[]>([])
  const [gender, setGender] = useState<string | null>(null)
  const [age, setAge] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (list: string[], v: string, set: (l: string[]) => void) => {
    setError(null)
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  const submit = () => {
    if (!district) return setError('Обери район')
    if (acts.length === 0) return setError('Обери хоча б одну активність')
    track('survey_submit', { district, activities: acts, days, gender, age })
    // TODO(stage 2): save to Supabase `waitlist` together with the Telegram user id.
    onDone()
  }

  return (
    <div className="page">
      <div className="logo logo-small">to.day</div>
      <h1 className="h1">Чотири питання — і ти в списку</h1>
      <p className="muted">Так ми зрозуміємо, який район відкривати першим.</p>

      <fieldset className="q">
        <legend>Де тобі зручно зустрічатися?</legend>
        <div className="chips">
          {DISTRICTS.map((d) => (
            <Chip
              key={d}
              on={district === d}
              onClick={() => {
                setError(null)
                setDistrict(d)
              }}
            >
              {d}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="q">
        <legend>Що хочеться робити?</legend>
        <div className="chips">
          {ACTIVITIES.map((a) => (
            <Chip key={a.id} on={acts.includes(a.id)} onClick={() => toggle(acts, a.id, setActs)}>
              {a.icon} {a.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="q">
        <legend>
          Коли зазвичай вільний ввечері? <span className="opt">необов’язково</span>
        </legend>
        <div className="chips">
          {DAYS.map((d) => (
            <Chip key={d} on={days.includes(d)} onClick={() => toggle(days, d, setDays)}>
              {d}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="q">
        <legend>
          Про тебе <span className="opt">необов’язково</span>
        </legend>
        <div className="chips">
          {GENDERS.map((g) => (
            <Chip key={g} on={gender === g} onClick={() => setGender(gender === g ? null : g)}>
              {g}
            </Chip>
          ))}
        </div>
        <div className="chips">
          {AGES.map((a) => (
            <Chip key={a} on={age === a} onClick={() => setAge(age === a ? null : a)}>
              {a}
            </Chip>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-wide" onClick={submit}>
        Готово
      </button>
    </div>
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

/* ---------- Done ---------- */

function Done() {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    track('share_tap')
    const url = location.origin + '?src=friend'
    const text = 'Шукаю компанію на вечір у Варшаві — приєднуйся до to.day'
    try {
      if (navigator.share) await navigator.share({ title: 'to.day', text, url })
      else {
        await navigator.clipboard.writeText(`${text} ${url}`)
        setCopied(true)
      }
    } catch {
      /* user closed the share dialog */
    }
  }
  return (
    <div className="page page-center">
      <div className="badge" aria-hidden="true">
        ✓
      </div>
      <h1 className="h1">Ти в списку</h1>
      <p className="muted">
        Напишемо тобі в Telegram, щойно відкриємо твій район. Чим більше людей поруч, тим
        швидше запуск.
      </p>
      <button className="btn btn-wide" onClick={share}>
        {copied ? 'Посилання скопійовано' : 'Поклич друга'}
      </button>
    </div>
  )
}
