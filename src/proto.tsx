/**
 * Working prototype of the live mode.
 * Everything runs in memory; other people's answers are simulated with timers.
 */
import { useEffect, useRef, useState } from 'react'
import { CITY_NAME, EVENTS, formatAreas, INVITERS, MAX_AREAS, PEOPLE, TAGS, VENUES, type FeedCard } from './feed'
import { detectTags } from './autotags'
import { Landing, Onboarding } from './landing'
import { isSignedIn, loadProfile, saveProfile, setSignedIn, type Profile } from './profile'
import { clearTgUser, inMiniApp, miniAppLogin, setupMiniApp } from './telegram'
import { identify, resetIdentity, track } from './track'
import {
  AreaPicker,
  CardView,
  DarkSheet,
  Dock,
  GenderAge,
  Sticker,
  type Tab,
  TagPill,
  UserIcon,
  useCountdown,
} from './ui'
import { TAG_COLORS } from './feed'

type Person = { name: string; age: number }

type Match = {
  id: string
  with: Person[]
  tag: string
  place: string
  time: string
  source: 'invite' | 'event' | 'incoming'
}

type Incoming = {
  from: Person
  tag: string
  place: string
  time: string
  note: string
  kind: 'invite' | 'join'
  /** Headline of the post this request answers */
  post: string
}

type Overlay =
  | { t: 'detail'; card: FeedCard }
  | { t: 'invite'; card: FeedCard }
  | { t: 'waiting'; card: FeedCard; place: string; time: string }
  | { t: 'declined'; card: FeedCard }
  | { t: 'joining'; card: FeedCard }
  | { t: 'match'; match: Match }
  | { t: 'create' }
  | { t: 'profile' }
  | { t: 'posted'; card: FeedCard }
  | { t: 'incoming'; inc: Incoming }
  | { t: 'reason'; inc: Incoming }
  | null

const ANSWER_SECONDS = 5 * 60
const FREE_CANCEL_SECONDS = 2 * 60

type Stage = 'connecting' | 'landing' | 'onboarding' | 'app'

export default function Proto() {
  useEffect(() => {
    const onHash = () => {
      if (!inMiniApp) location.reload()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [stage, setStage] = useState<Stage>(() => (isSignedIn() ? 'app' : inMiniApp ? 'connecting' : 'landing'))

  useEffect(() => {
    setupMiniApp()
    if (stage !== 'connecting') return
    track('login_start', { from: 'mini_app', via: 'mini_app' })
    miniAppLogin()
      .then((user) => {
        identify(String(user.id), { username: user.username, first_name: user.first_name })
        track('login_success', { real: true, via: 'mini_app' })
        setStage('onboarding')
      })
      .catch((e) => {
        track('login_error', { reason: e instanceof Error ? e.message : 'unknown', via: 'mini_app' })
        setStage('landing')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (stage === 'connecting')
    return (
      <div className="screen connecting" aria-busy="true">
        <span className="btn-spinner" aria-hidden="true" />
        <span>Підключаємо Telegram…</span>
      </div>
    )

  if (stage === 'landing') return <Landing onSignedIn={() => setStage('onboarding')} />
  if (stage === 'onboarding')
    return (
      <Onboarding
        profile={loadProfile()}
        onDone={(p) => {
          saveProfile(p)
          setSignedIn(true)
          setStage('app')
        }}
      />
    )
  return (
    <FeedApp
      onSignOut={() => {
        track('sign_out')
        resetIdentity()
        clearTgUser()
        setSignedIn(false)
        // On the real site go back to the landing page; inside Telegram or the preview, to the start screen.
        if (import.meta.env.VITE_TG_BOT_ID && !inMiniApp) location.href = `./${location.hash}`
        else setStage('landing')
      }}
    />
  )
}

function FeedApp({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('people')
  const [people, setPeople] = useState<FeedCard[]>(PEOPLE)
  const [events, setEvents] = useState<FeedCard[]>(EVENTS)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const timers = useRef<number[]>([])
  const overlayRef = useRef<Overlay>(null)
  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])

  useEffect(() => {
    track('feed_view', { mode: 'proto' })
    const ids = timers.current
    return () => ids.forEach(clearTimeout)
  }, [])

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const say = (text: string) => {
    setToast(text)
    later(2800, () => setToast((t) => (t === text ? null : t)))
  }

  const addMatch = (m: Match) => {
    track('match', { source: m.source, tag: m.tag })
    setMatches((list) => [m, ...list])
    setOverlay({ t: 'match', match: m })
  }

  const busyWaiting = overlay?.t === 'waiting' || overlay?.t === 'joining'

  /* ----- outgoing invite to a person ----- */
  const sendInvite = (card: FeedCard, place: string, time: string) => {
    track('invite_send', { card: card.id, place, time })
    setOverlay({ t: 'waiting', card, place, time })
    // Simulated answer: most people say yes in the demo.
    later(4500, () => {
      const yes = card.id !== 'person-2'
      track('invite_result', { card: card.id, yes })
      if (yes) {
        addMatch({
          id: `m-${Date.now()}`,
          with: [{ name: card.name, age: card.age }],
          tag: card.tags[0],
          place,
          time,
          source: 'invite',
        })
      } else {
        setOverlay({ t: 'declined', card })
      }
    })
  }

  /* ----- joining an event ----- */
  const joinEvent = (card: FeedCard) => {
    track('join_request', { card: card.id })
    setOverlay({ t: 'joining', card })
    later(3500, () => {
      setEvents((list) =>
        list.map((e) => (e.id === card.id ? { ...e, taken: (e.taken ?? 0) + 1 } : e)),
      )
      addMatch({
        id: `m-${Date.now()}`,
        with: [{ name: card.name, age: card.age }],
        tag: card.tags[0],
        place: card.venue ?? card.place,
        time: card.time,
        source: 'event',
      })
    })
  }

  /* ----- creating a post ----- */
  const publish = (card: FeedCard) => {
    if (card.kind === 'person') {
      setPeople((l) => [card, ...l.filter((c) => !c.mine)])
      setTab('people')
    } else {
      setEvents((l) => [card, ...l.filter((c) => !c.mine)])
      setTab('events')
    }
    setOverlay({ t: 'posted', card })

    // Simulated incoming invite / join request.
    const who = INVITERS.find((i) => card.tags.includes(i.tag)) ?? INVITERS[0]
    later(7000, () => {
      const inc: Incoming =
        card.kind === 'person'
          ? {
              from: { name: who.name, age: who.age },
              tag: card.tags.includes(who.tag) ? who.tag : card.tags[0],
              place: who.place,
              time: card.time.split(' - ')[0],
              note: 'Привіт! Можу підійти на 15 хвилин раніше.',
              kind: 'invite',
              post: card.headline,
            }
          : {
              from: { name: who.name, age: who.age },
              tag: card.tags[0],
              place: card.venue ?? card.place,
              time: card.time,
              note: 'Граю нечасто, але дуже хочу.',
              kind: 'join',
              post: card.headline,
            }
      if (overlayRef.current === null) setOverlay({ t: 'incoming', inc })
      else {
        say(`${who.name} надсилає тобі запит`)
        later(3000, () => setOverlay({ t: 'incoming', inc }))
      }
    })
  }

  const updateProfile = (next: Profile) => {
    track('profile_save', { hasBio: Boolean(next.bio) })
    setProfile(next)
    saveProfile(next)
    // Own posts show the profile bio, so refresh them too.
    const patch = (l: FeedCard[]) =>
      l.map((c) => (c.mine ? { ...c, bio: next.bio, gender: next.gender, age: next.age ?? 0 } : c))
    setPeople(patch)
    setEvents(patch)
  }

  const deleteMine = (card: FeedCard) => {
    track('post_delete', { kind: card.kind })
    if (card.kind === 'person') setPeople((l) => l.filter((c) => c.id !== card.id))
    else setEvents((l) => l.filter((c) => c.id !== card.id))
    setOverlay(null)
    say('Пост видалено')
  }

  const switchTab = (next: Tab) => {
    if (next === tab) return
    track('tab_switch', { to: next })
    setTab(next)
  }

  const cards = tab === 'people' ? people : events

  return (
    <div className="screen">
      <header className="screen-head screen-head-row">
        <div className="wordmark">
          today <span className="proto-tag">прототип, {CITY_NAME}</span>
        </div>
        <button
          className="profile-btn"
          aria-label="Профіль"
          onClick={() => setOverlay({ t: 'profile' })}
        >
          <UserIcon />
        </button>
      </header>

      {matches.length > 0 && (
        <button
          className="plan-banner"
          onClick={() => setOverlay({ t: 'match', match: matches[0] })}
        >
          <span className="plan-banner-dot" aria-hidden="true" />
          <span>
            Сьогодні: <b>{matches[0].tag}</b>, {matches[0].with[0].name}, {matches[0].time}
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      <ul className="cards" id="feed-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {cards.map((card) => (
          <li key={card.id}>
            <CardView
              card={card}
              onOpen={() => {
                track('card_tap', { card: card.id })
                setOverlay({ t: 'detail', card })
              }}
            />
          </li>
        ))}
        <li>
          <FeedEnd
            area={profile.areas?.[0]}
            kind={tab}
            onCreate={() => setOverlay({ t: 'create' })}
          />
        </li>
      </ul>

      <Dock tab={tab} onTab={switchTab} onCreate={() => setOverlay({ t: 'create' })} />

      {overlay?.t === 'detail' && (
        <DetailSheet
          card={overlay.card}
          onClose={() => setOverlay(null)}
          onInvite={() =>
            busyWaiting
              ? say('Спершу дочекайся відповіді на попереднє запрошення')
              : setOverlay({ t: 'invite', card: overlay.card })
          }
          onJoin={() => joinEvent(overlay.card)}
          onDelete={() => deleteMine(overlay.card)}
        />
      )}
      {overlay?.t === 'invite' && (
        <InviteSheet
          card={overlay.card}
          onClose={() => setOverlay(null)}
          onSend={(place, time) => sendInvite(overlay.card, place, time)}
        />
      )}
      {overlay?.t === 'waiting' && (
        <WaitingSheet
          title="Запрошення надіслано"
          text={`Людина має 5 хвилин, щоб відповісти. Поки чекаєш, нові запрошення надіслати не можна. ${overlay.place}, ${overlay.time}.`}
        />
      )}
      {overlay?.t === 'joining' && (
        <WaitingSheet
          title="Запит надіслано"
          text="Організатор підтверджує учасників. Зазвичай це хвилина-дві."
        />
      )}
      {overlay?.t === 'declined' && (
        <DarkSheet title="Не цього разу" onClose={() => setOverlay(null)}>
          <p className="dtext">
            Людина не зможе. Таке буває, це не про тебе. У стрічці є ще інші, хто вільний
            сьогодні.
          </p>
          <button className="dbtn" onClick={() => setOverlay(null)}>
            До стрічки
          </button>
        </DarkSheet>
      )}
      {overlay?.t === 'match' && (
        <MatchSheet
          match={overlay.match}
          onClose={() => setOverlay(null)}
          onCancel={(free) => {
            track('match_cancel', { free })
            setMatches((l) => l.filter((m) => m.id !== overlay.match.id))
            setOverlay(null)
            say(free ? 'Зустріч скасовано' : 'Зустріч скасовано. Це вплине на рейтинг')
          }}
          onUncomfortable={() => {
            track('uncomfortable')
            setMatches((l) => l.filter((m) => m.id !== overlay.match.id))
            setOverlay(null)
            say('Дякуємо, ми перевіримо. Скасовано без штрафу')
          }}
          onTelegram={() => say('У робочій версії тут відкриється чат у Telegram')}
        />
      )}
      {overlay?.t === 'create' && (
        <CreateSheet
          profile={profile}
          onProfile={updateProfile}
          onClose={() => setOverlay(null)}
          onPublish={publish}
        />
      )}
      {overlay?.t === 'posted' && (
        <PostedSheet card={overlay.card} onClose={() => setOverlay(null)} />
      )}
      {overlay?.t === 'profile' && (
        <ProfileSheet
          profile={profile}
          onSignOut={onSignOut}
          onClose={() => setOverlay(null)}
          onSave={(next) => {
            updateProfile(next)
            setOverlay(null)
            say('Профіль збережено')
          }}
        />
      )}
      {overlay?.t === 'incoming' && (
        <IncomingSheet
          inc={overlay.inc}
          onYes={() => {
            track('incoming_answer', { yes: true })
            addMatch({
              id: `m-${Date.now()}`,
              with: [overlay.inc.from],
              tag: overlay.inc.tag,
              place: overlay.inc.place,
              time: overlay.inc.time,
              source: 'incoming',
            })
          }}
          onNo={() => setOverlay({ t: 'reason', inc: overlay.inc })}
          onExpire={() => {
            track('incoming_answer', { expired: true })
            setOverlay(null)
            say('Час на відповідь вийшов')
          }}
        />
      )}
      {overlay?.t === 'reason' && (
        <ReasonSheet
          onPick={(reason) => {
            track('incoming_answer', { yes: false, reason })
            setOverlay(null)
            say('Відмову надіслано. Без пояснень і без образ')
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

/* ---------- Sheets ---------- */

function DetailSheet({
  card,
  onClose,
  onInvite,
  onJoin,
  onDelete,
}: {
  card: FeedCard
  onClose: () => void
  onInvite: () => void
  onJoin: () => void
  onDelete: () => void
}) {
  const left = (card.capacity ?? 0) - (card.taken ?? 0)
  return (
    <DarkSheet title={card.kind === 'person' ? 'Вільний час' : 'Подія'} onClose={onClose}>
      <div className="dsheet-card">
        <CardView card={card} />
      </div>
      {card.kind === 'event' && card.venue && <p className="dtext dsmall">Місце: {card.venue}</p>}
      {card.mine ? (
        <button className="dbtn dbtn-ghost" onClick={onDelete}>
          Видалити пост
        </button>
      ) : card.kind === 'person' ? (
        <>
          <button className="dbtn" onClick={onInvite}>
            Запросити
          </button>
          <p className="dhint">Ім’я та фото побачиш після того, як людина скаже «Так».</p>
        </>
      ) : (
        <>
          <button className="dbtn" onClick={onJoin} disabled={left <= 0}>
            {left > 0 ? `Я йду · ще ${left} ${left === 1 ? 'місце' : 'місця'}` : 'Місць немає'}
          </button>
          <p className="dhint">Організатор підтвердить запит, і відкриється чат.</p>
        </>
      )}
    </DarkSheet>
  )
}

function slotsFor(time: string): string[] {
  const [from, to] = time.split(' - ')
  if (!to) return [from]
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const out: string[] = []
  for (let m = toMin(from); m <= toMin(to) - 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out.length ? out : [from]
}

function InviteSheet({
  card,
  onClose,
  onSend,
}: {
  card: FeedCard
  onClose: () => void
  onSend: (place: string, time: string) => void
}) {
  const suggestions = [...new Set(card.tags.flatMap((t) => VENUES[t] ?? []))].slice(0, 4)
  const slots = slotsFor(card.time)
  const [place, setPlace] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [time, setTime] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const finalPlace = place === 'custom' ? custom.trim() : place
  const submit = () => {
    if (!finalPlace) return setError('Обери або напиши місце')
    if (!time) return setError('Обери час')
    onSend(finalPlace, time)
  }

  return (
    <DarkSheet title="Запросити" onClose={onClose}>
      <p className="dlabel">Куди</p>
      <div className="dchips">
        {suggestions.map((s) => (
          <button
            key={s}
            className={place === s ? 'dchip on' : 'dchip'}
            aria-pressed={place === s}
            onClick={() => {
              setPlace(s)
              setError(null)
            }}
          >
            {s}
          </button>
        ))}
        <button
          className={place === 'custom' ? 'dchip on' : 'dchip'}
          aria-pressed={place === 'custom'}
          onClick={() => {
            setPlace('custom')
            setError(null)
          }}
        >
          Своє місце
        </button>
      </div>
      {place === 'custom' && (
        <input
          className="dinput"
          placeholder="Наприклад, Кофеїн на Marszałkowska"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value)
            setError(null)
          }}
          autoFocus
        />
      )}

      <p className="dlabel">Коли</p>
      <div className="dchips">
        {slots.map((s) => (
          <button
            key={s}
            className={time === s ? 'dchip on' : 'dchip'}
            aria-pressed={time === s}
            onClick={() => {
              setTime(s)
              setError(null)
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p className="derror" role="alert">
          {error}
        </p>
      )}
      <button className="dbtn" onClick={submit}>
        Надіслати запрошення
      </button>
      <p className="dhint">Людина отримає запрошення в Telegram і матиме 5 хвилин на відповідь.</p>
    </DarkSheet>
  )
}

function WaitingSheet({ title, text }: { title: string; text: string }) {
  const { label } = useCountdown(ANSWER_SECONDS)
  return (
    <DarkSheet title={title}>
      <div className="wait">
        <span className="wait-ring" aria-hidden="true" />
        <span className="wait-time" aria-label={`Залишилось ${label}`}>
          {label}
        </span>
      </div>
      <p className="dtext">{text}</p>
    </DarkSheet>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name[0]}
    </span>
  )
}

function MatchSheet({
  match,
  onClose,
  onCancel,
  onUncomfortable,
  onTelegram,
}: {
  match: Match
  onClose: () => void
  onCancel: (free: boolean) => void
  onUncomfortable: () => void
  onTelegram: () => void
}) {
  const { left, label } = useCountdown(FREE_CANCEL_SECONDS)
  const free = left > 0
  const p = match.with[0]
  return (
    <DarkSheet
      title="Є матч!"
      tone="dark"
      onClose={onClose}
      heading={
        <Sticker
          size="lg"
          plus={false}
          lines={[
            { text: 'є матч!', tag: match.tag },
            { text: `о ${match.time}`, tag: 'Кава' },
          ]}
        />
      }
    >
      <div className="match-who">
        <Avatar name={p.name} />
        <div>
          <p className="match-name">
            {p.name}, {p.age}
          </p>
          <p className="dtext dsmall">
            {match.source === 'event' ? 'Організатор події' : 'Зустріч підтверджено'}
          </p>
        </div>
      </div>
      <div className="match-plan">
        <p>
          <TagPill tag={match.tag} size="lg" />
        </p>
        <p className="match-place">{match.place}</p>
      </div>
      <button className="dbtn" onClick={onTelegram}>
        Написати в Telegram
      </button>
      <button className="dbtn dbtn-ghost" onClick={() => onCancel(free)}>
        {free ? `Скасувати безкоштовно · ${label}` : 'Скасувати зустріч'}
      </button>
      <button className="dlink" onClick={onUncomfortable}>
        Мені некомфортно
      </button>
    </DarkSheet>
  )
}

function IncomingSheet({
  inc,
  onYes,
  onNo,
  onExpire,
}: {
  inc: Incoming
  onYes: () => void
  onNo: () => void
  onExpire: () => void
}) {
  const { left, label } = useCountdown(ANSWER_SECONDS)
  useEffect(() => {
    if (left === 0) onExpire()
  }, [left, onExpire])
  return (
    <DarkSheet title={inc.kind === 'invite' ? 'Тебе запрошують' : 'Хочуть приєднатися'}>
      <div className="match-plan">
        <p className="match-post">{inc.post}</p>
        <p>
          <TagPill tag={inc.tag} />
        </p>
        <p>{inc.place}</p>
        <p>Сьогодні о {inc.time}</p>
      </div>
      <p className="quote">«{inc.note}»</p>
      <p className="dtext dsmall">
        Ім’я та фото побачите одне одного після «Так». На відповідь: {label}.
      </p>
      <div className="drow">
        <button className="dbtn dbtn-ghost" onClick={onNo}>
          Ні
        </button>
        <button className="dbtn" onClick={onYes}>
          Так
        </button>
      </div>
    </DarkSheet>
  )
}

const REASONS = ['Далеко', 'Не той час', 'Не хочу сам на сам', 'Просто ні']

function ReasonSheet({ onPick }: { onPick: (r: string) => void }) {
  return (
    <DarkSheet title="Чому ні?" onClose={() => onPick('skip')}>
      <p className="dtext dsmall">Необов’язково. Людина не побачить причину.</p>
      <div className="dchips">
        {REASONS.map((r) => (
          <button key={r} className="dchip" onClick={() => onPick(r)}>
            {r}
          </button>
        ))}
      </div>
    </DarkSheet>
  )
}

const HOURS = Array.from({ length: 13 }, (_, i) => `${String(i + 11).padStart(2, '0')}:00`).flatMap(
  (h) => [h, h.replace(':00', ':30')],
)

const BIO_EXAMPLES = ['Працюю в IT, люблю каву', 'Нова в місті', 'Студент, граю в настолки']

function ProfileSheet({
  profile,
  onSignOut,
  onClose,
  onSave,
}: {
  profile: Profile
  onSignOut: () => void
  onClose: () => void
  onSave: (p: Profile) => void
}) {
  const [bio, setBio] = useState(profile.bio)
  const [ga, setGa] = useState<Pick<Profile, 'gender' | 'age'>>({
    gender: profile.gender,
    age: profile.age,
  })
  return (
    <DarkSheet title="Профіль" onClose={onClose}>
      <p className="dtext dsmall">
        Це бачать усі на твоїх постах. Ім’я та фото з Telegram відкриваються тільки після матчу.
      </p>
      <label className="dlabel" htmlFor="p-bio">
        Про себе
      </label>
      <input
        id="p-bio"
        className="dinput"
        maxLength={80}
        placeholder="Одним рядком: чим займаєшся, що любиш"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
      />
      <div className="dchips dchips-gap">
        {BIO_EXAMPLES.map((ex) => (
          <button key={ex} className="dchip dchip-small" onClick={() => setBio(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <p className="dhint dhint-left">{bio.length}/80, без імені, телефону й посилань</p>
      <p className="dlabel">
        Стать і вік <span className="dopt">необов’язково</span>
      </p>
      <GenderAge gender={ga.gender} age={ga.age} onChange={setGa} />
      <button className="dbtn" onClick={() => onSave({ ...profile, ...ga, bio: bio.trim() })}>
        Зберегти
      </button>
      <button className="dlink" onClick={onSignOut}>
        Вийти
      </button>
    </DarkSheet>
  )
}

function CreateSheet({
  profile,
  onProfile,
  onClose,
  onPublish,
}: {
  profile: Profile
  onProfile: (p: Profile) => void
  onClose: () => void
  onPublish: (card: FeedCard) => void
}) {
  const [kind, setKind] = useState<'person' | 'event'>('person')
  const [headline, setHeadline] = useState('')
  const [from, setFrom] = useState('18:00')
  const [to, setTo] = useState('21:00')
  const [at, setAt] = useState('20:00')
  const [areas, setAreas] = useState<string[]>(profile.areas ?? [])
  const [venue, setVenue] = useState('')
  const [tags, setTags] = useState<string[]>([])
  /** Tags added from the text, not by hand */
  const [auto, setAuto] = useState<string[]>([])
  /** Auto tags the person removed: never re-add them */
  const [removed, setRemoved] = useState<string[]>([])
  const [editBio, setEditBio] = useState(!profile.bio)
  const [bio, setBio] = useState(profile.bio)
  const [error, setError] = useState<string | null>(null)
  const maxTags = kind === 'person' ? 4 : 1

  const applyText = (text: string, k = kind, currentTags = tags, currentAuto = auto) => {
    const max = k === 'person' ? 4 : 1
    const manual = currentTags.filter((t) => !currentAuto.includes(t))
    const found = detectTags(text).filter((t) => !removed.includes(t))
    const next = [...manual]
    for (const t of found) if (!next.includes(t) && next.length < max) next.push(t)
    setTags(next)
    setAuto(next.filter((t) => !manual.includes(t)))
  }

  const toggleTag = (t: string) => {
    setError(null)
    if (tags.includes(t)) {
      if (auto.includes(t)) setRemoved([...removed, t])
      setAuto(auto.filter((x) => x !== t))
      return setTags(tags.filter((x) => x !== t))
    }
    setRemoved(removed.filter((x) => x !== t))
    if (kind === 'event') {
      setAuto([])
      return setTags([t])
    }
    if (tags.length >= maxTags) return setError(`Не більше ${maxTags} категорій`)
    setTags([...tags, t])
  }

  const switchKind = (k: 'person' | 'event') => {
    setKind(k)
    setError(null)
    if (k === 'event') setAreas(areas.slice(0, 1))
    else if (areas.length <= 1 && profile.areas?.length) setAreas(profile.areas)
    applyText(headline, k, k === 'event' ? tags.slice(0, 1) : tags, auto)
  }

  const submit = () => {
    if (!headline.trim()) return setError('Напиши кілька слів про план')
    if (tags.length === 0) return setError('Обери категорію')
    if (kind === 'person' && to <= from) return setError('Кінець має бути пізніше за початок')
    if (areas.length === 0) return setError('Обери район')
    if (kind === 'event' && !venue.trim()) return setError('Вкажи місце')
    const finalBio = bio.trim()
    if (finalBio !== profile.bio) onProfile({ ...profile, bio: finalBio })
    track('post_create', { kind, autoTags: auto, manualTags: tags.filter((t) => !auto.includes(t)) })
    onPublish({
      id: `mine-${Date.now()}`,
      kind,
      headline: headline.trim(),
      bio: finalBio,
      time: kind === 'person' ? `${from} - ${to}` : at,
      place: formatAreas(areas),
      venue: kind === 'event' ? venue.trim() : undefined,
      tags,
      name: 'Ти',
      age: profile.age ?? 0,
      gender: profile.gender,
      taken: kind === 'event' ? 1 : undefined,
      capacity: kind === 'event' ? 4 : undefined,
      mine: true,
    })
  }

  return (
    <DarkSheet title="Новий пост" onClose={onClose}>
      <div className="dseg" role="tablist" aria-label="Тип поста">
        <button
          role="tab"
          aria-selected={kind === 'person'}
          className={kind === 'person' ? 'on' : ''}
          onClick={() => switchKind('person')}
        >
          Я вільний
        </button>
        <button
          role="tab"
          aria-selected={kind === 'event'}
          className={kind === 'event' ? 'on' : ''}
          onClick={() => switchKind('event')}
        >
          Подія
        </button>
      </div>

      <label className="dlabel" htmlFor="c-headline">
        {kind === 'person' ? 'Що хочеш сьогодні?' : 'Що за подія?'}
      </label>
      <textarea
        id="c-headline"
        className="dinput"
        rows={2}
        maxLength={120}
        placeholder={
          kind === 'person'
            ? 'Вільний вечір. Хочу на каву або пройтись'
            : 'Граю в більярд о 20:00, шукаю ще двох'
        }
        value={headline}
        onChange={(e) => {
          setHeadline(e.target.value)
          setError(null)
          applyText(e.target.value)
        }}
      />

      <p className="dlabel">
        {kind === 'person' ? 'Категорії' : 'Категорія'}{' '}
        <span className="dopt">{kind === 'person' ? 'до 4' : 'одна'}</span>
      </p>
      <div className="dchips">
        {TAGS.map((t) => (
          <button
            key={t}
            className={tags.includes(t) ? 'dchip tag on' : 'dchip tag'}
            aria-pressed={tags.includes(t)}
            style={
              tags.includes(t)
                ? { background: TAG_COLORS[t].bg, borderColor: TAG_COLORS[t].bg, color: TAG_COLORS[t].fg }
                : undefined
            }
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {auto.length > 0 && (
        <p className="dhint dhint-left" aria-live="polite">
          Відмітили за твоїм текстом: {auto.join(', ')}. Можна змінити.
        </p>
      )}

      <p className="dlabel">{kind === 'person' ? 'Коли вільний' : 'Коли'}</p>
      {kind === 'person' ? (
        <div className="drow">
          <select className="dinput" aria-label="З" value={from} onChange={(e) => setFrom(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
          <select className="dinput" aria-label="До" value={to} onChange={(e) => setTo(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </div>
      ) : (
        <select className="dinput" aria-label="Час" value={at} onChange={(e) => setAt(e.target.value)}>
          {HOURS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      )}

      <p className="dlabel">
        {kind === 'person' ? 'Райони' : 'Район'}{' '}
        <span className="dopt">{kind === 'person' ? `до ${MAX_AREAS}` : 'один'}</span>
      </p>
      <AreaPicker
        value={areas}
        multi={kind === 'person'}
        onChange={(next) => {
          setAreas(next)
          setError(null)
        }}
        onError={setError}
      />

      {kind === 'event' && (
        <>
          <label className="dlabel" htmlFor="c-venue">
            Місце
          </label>
          <input
            id="c-venue"
            className="dinput"
            placeholder="Тільки публічне місце: кафе, бар, парк"
            value={venue}
            onChange={(e) => {
              setVenue(e.target.value)
              setError(null)
            }}
          />
        </>
      )}

      {editBio ? (
        <>
          <label className="dlabel" htmlFor="c-bio">
            Про себе <span className="dopt">збережемо в профіль</span>
          </label>
          <input
            id="c-bio"
            className="dinput"
            maxLength={80}
            placeholder="Одним рядком: хто ти"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </>
      ) : (
        <div className="bio-line">
          <UserIcon />
          <span>{bio}</span>
          <button className="dlink dlink-inline" onClick={() => setEditBio(true)}>
            Змінити
          </button>
        </div>
      )}

      {error && (
        <p className="derror" role="alert">
          {error}
        </p>
      )}
      <button className="dbtn" onClick={submit}>
        Опублікувати
      </button>
    </DarkSheet>
  )
}

/* ---------- Brand moments: posted, feed end ---------- */

function PostedSheet({ card, onClose }: { card: FeedCard; onClose: () => void }) {
  return (
    <DarkSheet
      title="Пост в ефірі"
      onClose={onClose}
      heading={
        <Sticker
          lines={[
            { text: 'твій план', tag: card.tags[0] ?? 'Кава' },
            { text: 'в ефірі', tag: 'Ігри' },
          ]}
        />
      }
    >
      <p className="dtext">
        Запрошення прийдуть сюди й повідомленням у Telegram. У кожного буде 5 хвилин, щоб ти встиг
        відповісти.
      </p>
      <div className="dsheet-card">
        <CardView card={card} />
      </div>
      <button className="dbtn" onClick={onClose}>
        До стрічки
      </button>
    </DarkSheet>
  )
}

function FeedEnd({
  area,
  kind,
  onCreate,
}: {
  area?: string
  kind: Tab
  onCreate: () => void
}) {
  const where = area && !area.startsWith('Ці') && !area.startsWith('Ве') ? ` у ${area}` : ' поруч'
  return (
    <div className="feed-end">
      <Sticker
        as="p"
        size="sm"
        lines={[
          { text: 'поки тихо', tag: 'Спорт' },
          { text: kind === 'people' ? 'будь першим' : 'створи подію', tag: 'Ігри' },
        ]}
      />
      <p className="feed-end-text">
        Більше нікого{where} на сьогодні. Напиши, що хочеш, і люди побачать твій план першим.
      </p>
      <button className="dbtn" onClick={onCreate}>
        {kind === 'people' ? 'Я вільний сьогодні' : 'Створити подію'}
      </button>
    </div>
  )
}
