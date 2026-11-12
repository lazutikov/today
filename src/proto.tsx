/**
 * Working prototype of the live mode.
 * Demo cards answer by themselves (simulated). Posts by real people come from
 * the server, and requests to them reach a real person through the bot.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { mapsLink, nearestArea, type Place } from './places'

const PlacePicker = lazy(() => import('./PlacePicker'))
const DetailMap = lazy(() => import('./DetailMap'))
import { guardianNames, loadSafety as loadSafetyNow, setLive, stopSafety, syncSafety, SafetySetup, TrustedSection, useSafetyStore, type Safety } from './safety'
import { CITY, EVENTS, formatAreas, INVITERS, KHARKIV_EVENTS, KHARKIV_PEOPLE, KHARKIV_VENUES, PEOPLE, TAGS, VENUES, type FeedCard } from './feed'
import { detectTags } from './autotags'
import { Landing, Onboarding } from './landing'
import { isSignedIn, loadProfile, saveProfile, setSignedIn, type Profile } from './profile'
import { guessGender } from './gender'
import { NotificationsPage } from './notifications'
import { rankFeed } from './rank'
import { filterByQuery } from './search'
import { cardPoint, distanceKm, roundPoint, useMyLocation, type Coords } from './location'
import { NearField, ReachChips, type Near } from './NearField'
import { getSpot, isHomeCity, setSpot, useSpot } from './area'

const getSpotKey = () => getSpot().key
import { spotAt } from './places'
import { SpotPicker } from './SpotPicker'
import { clearTgUser, inMiniApp, loadSession, loadTgUser, miniAppLogin, setupMiniApp, telegramEnabled } from './telegram'
import { identify, resetIdentity, track } from './track'
import {
  answerRequest,
  cancelMeetingApi,
  createPost,
  fetchMeetings,
  fetchMe,
  fetchNotifs,
  saveProfileRemote,
  markNotifsSeen,
  type Notif,
  fetchInbox,
  fetchPosts,
  isLive,
  removePost,
  requestStatus,
  sendRequest,
} from './live'
import {
  CardView,
  DarkSheet,
  Dock,
  GenderAge,
  Sticker,
  type Tab,
  TagPill,
  BellIcon,
  FilterIcon,
  SearchIcon,
  ClockIcon,
  shortAddress,
  PinIcon,
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
  /** Real matches: server request id, link that opens a chat with the person, and their Telegram photo */
  reqId?: string
  /** Meeting point, when picked on the map */
  address?: string
  lat?: number
  lon?: number
  /** The other person cancelled: shown as a grey notice until dismissed */
  cancelled?: boolean
  contact?: string
  photo?: string
  /** The plan or post this match came from: hidden from the feed while the match stands */
  cardId?: string
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
  /** Short street address of the place, if known */
  address?: string
  /** Real requests: server id and deadline */
  reqId?: string
  expiresAt?: number
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
  | { t: 'notifs' }
  | { t: 'spot' }
  | { t: 'filters' }
  | { t: 'safety'; match: Match }
  | { t: 'safety-bot'; match: Match }
  | null

const ANSWER_SECONDS = 5 * 60
const FREE_CANCEL_SECONDS = 2 * 60

type Stage = 'connecting' | 'landing' | 'onboarding' | 'app'

/** First visit: pre-select gender from the Telegram name; the person can change it right there. */
function withGuessedGender(p: Profile): Profile {
  if (p.gender) return p
  const guess = guessGender(loadTgUser()?.first_name)
  return guess ? { ...p, gender: guess } : p
}

export default function Proto() {
  useEffect(() => {
    const onHash = () => {
      if (!inMiniApp) location.reload()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // On the real site a sign-in without a server session (made before the shared feed) doesn't count.
  const signedIn = () => isSignedIn() && (!telegramEnabled || Boolean(loadSession()))
  const [stage, setStage] = useState<Stage>(() => (signedIn() ? 'app' : inMiniApp ? 'connecting' : 'landing'))

  useEffect(() => {
    setupMiniApp()
    if (stage !== 'connecting') return
    track('login_start', { from: 'mini_app', via: 'mini_app' })
    miniAppLogin()
      .then((user) => {
        identify(String(user.id), { username: user.username, first_name: user.first_name })
        track('login_success', { real: true, via: 'mini_app' })
        afterLogin()
      })
      .catch((e) => {
        track('login_error', { reason: e instanceof Error ? e.message : 'unknown', via: 'mini_app' })
        setStage('landing')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Known person on a new device: restore their profile from the server and skip onboarding. */
  function afterLogin() {
    setStage('connecting')
    fetchMe()
      .then(({ profile }) => {
        if (profile && (profile.areas?.length || profile.places?.length || profile.updatedAt)) {
          saveProfile({ bio: profile.bio, areas: profile.areas, gender: profile.gender, age: profile.age, notify: profile.notify, places: profile.places, radius: profile.radius })
          setSignedIn(true)
          track('profile_restored')
          setStage('app')
        } else setStage('onboarding')
      })
      .catch(() => setStage('onboarding'))
  }

  if (stage === 'connecting')
    return (
      <div className="screen connecting" aria-busy="true">
        <span className="btn-spinner" aria-hidden="true" />
        <span>Підключаємо Telegram…</span>
      </div>
    )

  if (stage === 'landing') return <Landing onSignedIn={afterLogin} />
  if (stage === 'onboarding')
    return (
      <Onboarding
        profile={withGuessedGender(loadProfile())}
        onDone={(p) => {
          saveProfile(p)
          saveProfileRemote(p, getSpotKey())
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

/* Own posts survive reloads and re-login, but only for today (it's a same-day service). */
const MY_POSTS = 'today.myPosts'

function loadMyPosts(): FeedCard[] {
  try {
    const saved = JSON.parse(localStorage.getItem(MY_POSTS) || 'null') as { day: string; cards: FeedCard[] } | null
    return saved && saved.day === new Date().toDateString() ? saved.cards : []
  } catch {
    return []
  }
}

function saveMyPosts(cards: FeedCard[]) {
  try {
    localStorage.setItem(MY_POSTS, JSON.stringify({ day: new Date().toDateString(), cards }))
  } catch {
    /* memory only */
  }
}

function FeedApp({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('events')
  // Signed in through the server: own posts and answers are real. Otherwise everything is a local demo.
  const [live] = useState(isLive)
  const [people, setPeople] = useState<FeedCard[]>(() =>
    live ? PEOPLE : [...loadMyPosts().filter((c) => c.kind === 'person'), ...PEOPLE],
  )
  const [events, setEvents] = useState<FeedCard[]>(() =>
    live ? EVENTS : [...loadMyPosts().filter((c) => c.kind === 'event'), ...EVENTS],
  )
  const [realPosts, setRealPosts] = useState<FeedCard[]>([])
  // Position for distances: never leaves the phone
  const here = useMyLocation()
  // "Звідки": the city the feed is about (follows the phone unless picked by hand)
  const spot = useSpot()
  const home = isHomeCity(spot)
  const from: Coords | null = spot.precise ? { lat: spot.lat, lon: spot.lon } : null
  useEffect(() => {
    if (spot.mode !== 'auto' || !here.coords) return
    const c = here.coords
    if (spot.precise && Math.abs(spot.lat - c.lat) < 0.002 && Math.abs(spot.lon - c.lon) < 0.002) return
    const ctrl = new AbortController()
    spotAt(c.lat, c.lon, ctrl.signal)
      .then((next) => {
        setSpot(next)
        track('spot_auto', { city: next.key })
      })
      .catch(() => {})
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here.coords, spot.mode])
  const [locHidden, setLocHidden] = useState(() => {
    try {
      return localStorage.getItem('today.locPromptHidden') === '1'
    } catch {
      return false
    }
  })
  const [notifs, setNotifs] = useState<{ items: Notif[]; seen: number }>({ items: [], seen: 0 })
  const unread = notifs.items.filter((n) => n.at > notifs.seen).length
  const mergeNotifs = (next: { items: Notif[]; seen: number }) =>
    setNotifs((cur) => ({ items: next.items, seen: Math.max(cur.seen, next.seen) }))
  // What counted as "new" at the moment the page was opened (highlighted while it stays open)
  const [pageSeen, setPageSeen] = useState(0)
  // Cancelled-meeting notices the person already closed
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('today.dismissed') || '[]')
    } catch {
      return []
    }
  })
  const dismiss = (id: string) =>
    setDismissed((d) => {
      const next = [...d, id].slice(-50)
      try {
        localStorage.setItem('today.dismissed', JSON.stringify(next))
      } catch {
        /* memory only */
      }
      return next
    })
  const refreshPosts = () => {
    if (!live) return
    fetchPosts(getSpotKey()).then(setRealPosts)
    fetchNotifs().then(mergeNotifs)
    fetchMeetings().then((list) => {
      const real: Match[] = list.map((m) => ({
        id: `m-${m.id}`,
        reqId: m.id,
        with: [{ name: m.name, age: m.age }],
        tag: m.tag,
        place: m.place,
        address: m.address,
        time: m.time,
        source: m.source,
        contact: m.contact,
        photo: m.photo,
        cancelled: m.cancelled,
        lat: m.lat,
        lon: m.lon,
        cardId: m.postId,
      }))
      // Server is the truth for real meetings; demo matches stay local.
      setMatches((cur) => [...real, ...cur.filter((x) => !x.reqId)])
    })
  }

  useEffect(() => {
    saveMyPosts([...people, ...events].filter((c) => c.mine))
  }, [people, events])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const { safety } = useSafetyStore()
  // Real site: is the feature on, who are my trusted people, did the bot get my location
  useEffect(() => {
    syncSafety()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible' && loadSafetyNow()) syncSafety()
    }, 20000)
    return () => window.clearInterval(id)
  }, [])
  const [toast, setToast] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const timers = useRef<number[]>([])
  const overlayRef = useRef<Overlay>(null)
  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])

  useEffect(() => {
    track('feed_view', { mode: live ? 'live' : 'proto' })
    const ids = timers.current
    return () => ids.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ----- real feed and incoming requests (polling) ----- */
  const seenInbox = useRef(new Set<string>())
  // Another city picked: reload its plans
  const firstSpot = useRef(true)
  useEffect(() => {
    if (firstSpot.current) {
      firstSpot.current = false
      return
    }
    setRealPosts([])
    refreshPosts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.key])
  const deepLink = useRef(new URLSearchParams(location.search).get('post'))
  useEffect(() => {
    const id = deepLink.current
    if (!id) return
    const card = realPosts.find((c) => c.id === id)
    if (!card) return
    deepLink.current = null
    history.replaceState(null, '', location.pathname + location.hash)
    track('deep_link', { kind: card.kind })
    setTab(card.kind === 'person' ? 'people' : 'events')
    setOverlay({ t: 'detail', card })
  }, [realPosts])
  useEffect(() => {
    if (!live) return
    refreshPosts()
    fetchMe().then(({ profile: remote }) => {
      if (!remote) {
        saveProfileRemote(loadProfile(), getSpotKey()) // first time on the server: upload what this device has
        return
      }
      const next: Profile = { bio: remote.bio, areas: remote.areas, gender: remote.gender, age: remote.age, notify: remote.notify, places: remote.places, radius: remote.radius }
      setProfile(next)
      saveProfile(next)
    })
    // Poll only while the app is on screen: a hidden tab costs nothing (free Redis has a monthly quota).
    const visible = () => document.visibilityState === 'visible'
    const feed = window.setInterval(() => visible() && refreshPosts(), 30000)
    const bell = window.setInterval(() => visible() && fetchNotifs().then(mergeNotifs), 15000)
    const onVisible = () => document.visibilityState === 'visible' && refreshPosts()
    document.addEventListener('visibilitychange', onVisible)
    const inbox = window.setInterval(async () => {
      if (!visible()) return
      const cur = overlayRef.current
      if (cur && cur.t !== 'detail' && cur.t !== 'posted') return
      const items = await fetchInbox()
      const next = items.find((i) => !seenInbox.current.has(i.id))
      if (!next) return
      seenInbox.current.add(next.id)
      const who = [next.from.gender || 'Стать не вказана', next.from.age || ''].filter(Boolean).join(', ')
      track('incoming_view', { real: true, kind: next.type })
      setOverlay({
        t: 'incoming',
        inc: {
          from: { name: next.from.gender || 'Стать не вказана', age: next.from.age },
          tag: next.tag,
          place: next.place,
          address: next.address,
          time: next.time,
          note: [who, next.from.bio].filter(Boolean).join(': ') || 'Без опису',
          kind: next.type,
          post: next.post,
          reqId: next.id,
          expiresAt: next.expiresAt,
        },
      })
    }, 8000)
    return () => {
      window.clearInterval(feed)
      window.clearInterval(bell)
      window.clearInterval(inbox)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Sends a real invite / join request and waits for the person's answer. */
  const realRequest = async (
    card: FeedCard,
    extra: { place?: string; time?: string; lat?: number; lon?: number; address?: string },
  ) => {
    const res = await sendRequest(card.id, extra, profile)
    if (res.ok === false) {
      const msg: Record<string, string> = {
        busy: 'Спершу дочекайся відповіді на попереднє запрошення',
        full: 'Місць уже немає',
        own_post: 'Це твій пост',
        post_gone: 'Цей план уже неактуальний',
        taken: 'Ця людина вже знайшла компанію на сьогодні',
        blocked: 'Твій акаунт обмежено після скарги. Якщо це помилка, напиши нам у Telegram.',
        conflict: res.message ?? 'У тебе вже є зустріч на цей час',
      }
      setOverlay(null)
      say(msg[res.error] ?? 'Не вийшло надіслати, спробуй ще раз')
      if (res.error === 'post_gone' || res.error === 'taken') refreshPosts()
      return
    }
    const id = res.request.id
    const poll = async () => {
      const st = await requestStatus(id)
      if (!st || st.status === 'pending') return later(3000, poll)
      track(card.kind === 'event' ? 'join_result' : 'invite_result', { card: card.id, real: true, status: st.status })
      if (st.status === 'yes' && st.match) {
        refreshPosts()
        addMatch({
          id: `m-${id}`,
          reqId: id,
          with: [{ name: st.match.name, age: card.age }],
          tag: st.match.tag,
          place: st.match.place,
          address: st.match.address,
          time: st.match.time,
          source: card.kind === 'event' ? 'event' : 'invite',
          cardId: card.id,
          contact: st.match.contact,
          photo: st.match.photo,
          lat: st.match.lat,
          lon: st.match.lon,
        })
      } else {
        setOverlay({ t: 'declined', card })
      }
    }
    later(3000, poll)
  }

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const say = (text: string) => {
    setToast(text)
    later(2800, () => setToast((t) => (t === text ? null : t)))
  }

  const addMatch = (m: Match) => {
    track('match', { source: m.source, tag: m.tag, real: Boolean(m.reqId) })
    setMatches((list) => [m, ...list.filter((x) => x.id !== m.id)])
    setOverlay({ t: 'match', match: m })
  }

  const busyWaiting = overlay?.t === 'waiting' || overlay?.t === 'joining'

  /** Another meeting today starting within 1.5 h of this time (the same plan doesn't count). */
  const clash = (time: string, sameAs?: (m: Match) => boolean) => {
    const toMin = (t: string) => {
      const x = /(\d{1,2}):(\d{2})/.exec(t)
      return x ? Number(x[1]) * 60 + Number(x[2]) : null
    }
    const at = toMin(time)
    if (at === null) return null
    return (
      matches.find((m) => {
        if (m.cancelled || sameAs?.(m)) return false
        const t = toMin(m.time)
        return t !== null && Math.abs(t - at) < 90
      }) ?? null
    )
  }
  const clashSay = (m: Match) =>
    say(`У тебе вже є зустріч о ${m.time}: ${m.with[0].name}. Скасуй її або обери інший час`)

  /* ----- outgoing invite to a person ----- */
  const sendInvite = (card: FeedCard, place: string, time: string, geo?: Place) => {
    const busy = clash(time)
    if (busy) return clashSay(busy)
    track('invite_send', { card: card.id, place, time, real: Boolean(card.real), onMap: Boolean(geo) })
    setOverlay({ t: 'waiting', card, place, time })
    if (card.real) {
      const extra = geo && Number.isFinite(geo.lat) ? { lat: geo.lat, lon: geo.lon, address: geo.address } : {}
      return void realRequest(card, { place, time, ...extra })
    }
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
    const busy = clash(card.time)
    if (busy) {
      setOverlay(null)
      return clashSay(busy)
    }
    track('join_request', { card: card.id, real: Boolean(card.real) })
    setOverlay({ t: 'joining', card })
    if (card.real) return void realRequest(card, {})
    later(3500, () => {
      setEvents((list) =>
        list.map((e) => (e.id === card.id ? { ...e, taken: (e.taken ?? 0) + 1 } : e)),
      )
      addMatch({
        id: `m-${Date.now()}`,
        with: [{ name: card.name, age: card.age }],
        tag: card.tags[0],
        place: card.venue ?? card.place,
        address: shortAddress(card.venueAddress),
        lat: card.lat,
        lon: card.lon,
        time: card.time,
        source: 'event',
        cardId: card.id,
      })
    })
  }

  /* ----- creating a post ----- */
  const publish = async (card: FeedCard) => {
    if (live) {
      // Real post: everyone signed in sees it; answers come from real people only.
      const saved = await createPost(card, spot.key)
      if (!saved) return say('Не вдалося опублікувати, спробуй ще раз')
      setRealPosts((l) => [saved, ...l.filter((c) => !(c.mine && c.kind === saved.kind))])
      setTab(saved.kind === 'person' ? 'people' : 'events')
      setOverlay({ t: 'posted', card: saved })
      return
    }
    if (card.kind === 'person') {
      setPeople((l) => [card, ...l.filter((c) => !c.mine)])
      setTab('people')
    } else {
      setEvents((l) => [card, ...l.filter((c) => !c.mine)])
      setTab('events')
    }
    setOverlay({ t: 'posted', card })

    // Simulated incoming invite / join request: demo preview only. On the real site
    // a person's own post is answered by real people or not at all.
    if (telegramEnabled) return
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
    track('profile_save', { hasBio: Boolean(next.bio), notify: next.notify !== false })
    setProfile(next)
    saveProfile(next)
    saveProfileRemote(next, getSpotKey())
    // Own posts show the profile bio, so refresh them too.
    const patch = (l: FeedCard[]) =>
      l.map((c) => (c.mine ? { ...c, bio: next.bio, gender: next.gender, age: next.age ?? 0 } : c))
    setPeople(patch)
    setEvents(patch)
  }

  const deleteMine = (card: FeedCard) => {
    track('post_delete', { kind: card.kind })
    if (card.real) {
      removePost(card.id)
      setRealPosts((l) => l.filter((c) => c.id !== card.id))
      setOverlay(null)
      return say('Пост видалено')
    }
    if (card.kind === 'person') setPeople((l) => l.filter((c) => c.id !== card.id))
    else setEvents((l) => l.filter((c) => c.id !== card.id))
    setOverlay(null)
    say('Пост видалено')
  }

  /* ----- notifications ----- */
  const openNotifs = () => {
    track('notifs_open', { unread })
    setPageSeen(notifs.seen)
    setOverlay({ t: 'notifs' })
    // Read the moment the page opens: the badge clears now, the server remembers it for other devices.
    const now = Date.now()
    setNotifs((n) => ({ ...n, seen: Math.max(n.seen, now) }))
    if (unread > 0) markNotifsSeen()
  }

  const openNotif = (n: Notif) => {
    track('notif_tap', { type: n.type })
    const card = [...realPosts, ...people, ...events].find((c) => c.id === n.postId)
    if (n.type === 'request') {
      if ((n.expiresAt ?? 0) <= Date.now()) return say('Час на відповідь уже вийшов')
      seenInbox.current.add(n.reqId)
      return setOverlay({
        t: 'incoming',
        inc: {
          from: { name: '', age: 0 },
          tag: n.tag,
          place: n.place,
          time: n.time,
          note: n.who || 'Без опису',
          kind: n.kind ?? 'invite',
          post: n.post,
          reqId: n.reqId,
          expiresAt: n.expiresAt,
        },
      })
    }
    if (n.type === 'match') {
      const m = matches.find((x) => x.reqId === n.reqId)
      if (m && !m.cancelled) return setOverlay({ t: 'match', match: m })
      return say('Цю зустріч уже скасовано')
    }
    if (card) return setOverlay({ t: 'detail', card })
    say('Цей план уже неактуальний')
  }

  const switchTab = (next: Tab) => {
    if (next === tab) return
    track('tab_switch', { to: next })
    setTab(next)
  }

  const [query, setQuery] = useState('')
  const [filters, setFiltersRaw] = useState<Filters>(loadFilters)
  const setFilters = (f: Filters) => {
    setFiltersRaw(f)
    saveFilters(f)
    track('feed_filter', { radius: f.radius ?? 'any', cats: f.cats.length })
  }
  // Demo cards live in the launch city only; elsewhere the feed is just real people
  // Kharkiv has its own demo cards; other cities show only real posts (and mine)
  const kharkiv = spot.key === 'kharkiv'
  const local = (l: FeedCard[], kh: FeedCard[]) =>
    home ? l : kharkiv ? [...l.filter((c) => c.mine), ...kh] : l.filter((c) => c.mine)
  // Plans I'm already in live in the banner on top, not in the feed
  const joined = new Set(matches.filter((m) => !m.cancelled && m.cardId).map((m) => m.cardId))
  const notJoined = (l: FeedCard[]) => l.filter((c) => c.mine || !joined.has(c.id))
  const cards = rankFeed(
    tab === 'people'
      ? notJoined([...realPosts.filter((c) => c.kind === 'person'), ...local(people, KHARKIV_PEOPLE)])
      : notJoined([...realPosts.filter((c) => c.kind === 'event'), ...local(events, KHARKIV_EVENTS)]),
    home ? (profile.areas ?? []) : [],
    new Date(),
    from,
  )
  const radiusOn = filters.radius !== null && Boolean(from)
  const shown = filterByQuery(cards, query).filter((c) => {
    if (filters.cats.length && !c.tags.some((t) => filters.cats.includes(t))) return false
    if (radiusOn) {
      const pt = cardPoint(c)
      return pt ? distanceKm(from!, pt) <= filters.radius! : false
    }
    return true
  })
  const filtering = Boolean(query.trim()) || filters.cats.length > 0 || radiusOn
  // Badge on the filter button: distance counts once, each category once
  const activeFilters = (radiusOn ? 1 : 0) + filters.cats.length
  // What people look for (length and result count only, not the words)
  useEffect(() => {
    if (!query.trim()) return
    const t = window.setTimeout(() => track('feed_search', { len: query.trim().length, results: shown.length, tab }), 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div className="screen">
      <header className="screen-head screen-head-row">
        <div className="wordmark">
          today
          <button
            className="spot-btn"
            onClick={() => setOverlay({ t: 'spot' })}
            aria-label={`Звідки: ${spot.label}. Змінити`}
          >
            <PinIcon />
            <span className="spot-btn-text">{spot.label}</span>
            <span className="spot-btn-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
        <div className="head-actions">
          {live && (
            <button
              className="profile-btn bell-btn"
              aria-label={unread ? `Сповіщення, нових: ${unread}` : 'Сповіщення'}
              onClick={openNotifs}
            >
              <BellIcon />
              {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button
            className="profile-btn"
            aria-label="Профіль"
            onClick={() => setOverlay({ t: 'profile' })}
          >
            <UserIcon />
          </button>
        </div>
      </header>

      {matches.map((m) =>
        m.cancelled ? (
          dismissed.includes(m.id) ? null : (
            <button
              key={m.id}
              className="plan-banner plan-banner-off"
              aria-label={`${m.with[0].name} скасував(ла) зустріч. Сховати`}
              onClick={() => dismiss(m.id)}
            >
              <span>
                <b>{m.with[0].name}</b> скасував(ла) зустріч: {m.tag}, {m.time}
              </span>
              <span aria-hidden="true">✕</span>
            </button>
          )
        ) : (
        <button key={m.id} className="plan-banner" onClick={() => setOverlay({ t: 'match', match: m })}>
          <span className="plan-banner-dot" aria-hidden="true" />
          <span>
            Сьогодні: <b>{m.tag}</b>, {m.with[0].name}, {m.time}
            {safety?.matchId === m.id && (
              <span className="plan-banner-safe">
                🛡 {safety.live ? `${guardianNames(safety)} знає, де ти, до ${safety.until}` : 'Залишився крок: геопозиція в боті'}
              </span>
            )}
          </span>
          <span aria-hidden="true">→</span>
        </button>
        ),
      )}

      {spot.mode === 'auto' && !spot.precise && !locHidden && tab === 'events' && (
        <div className="loc-chip">
          <button
            className="loc-chip-main"
            onClick={here.request}
            disabled={here.state === 'asking' || here.state === 'far'}
          >
            📍{' '}
            {here.state === 'asking'
              ? 'Шукаю, де ти…'
              : here.state === 'off'
                ? 'Не вдалося визначити. Спробувати ще раз'
                : here.state === 'denied'
                  ? 'Геолокацію вимкнено. Увімкни: 🔒 біля адреси сайту → Дозволи, і натисни тут'
                  : here.state === 'far'
                    ? `Ти зараз не ${CITY === 'warsaw' ? 'у Варшаві' : 'у Львові'}, тому час у дорозі не показуємо`
                    : 'Показати, скільки добиратися до планів'}
          </button>
          <button
            className="loc-chip-x"
            aria-label="Сховати"
            onClick={() => {
              setLocHidden(true)
              try {
                localStorage.setItem('today.locPromptHidden', '1')
              } catch {
                /* ignore */
              }
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="feed-tools">
      <div className="feed-search" role="search">
        <SearchIcon />
        <input
          type="search"
          placeholder={tab === 'events' ? `Кава, більярд, ${home ? 'Сихів' : kharkiv ? 'Салтівка' : 'центр'}…` : 'Прогулянка, кіно, Центр…'}
          aria-label="Пошук у стрічці"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
        {query && (
          <button className="feed-search-x" aria-label="Очистити пошук" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </div>
      <button
        className={activeFilters ? 'filter-btn on' : 'filter-btn'}
        onClick={() => setOverlay({ t: 'filters' })}
        aria-label={activeFilters ? `Фільтри, увімкнено: ${activeFilters}` : 'Фільтри'}
        aria-haspopup="dialog"
      >
        <FilterIcon />
        {activeFilters > 0 && <span className="filter-badge">{activeFilters}</span>}
      </button>
      </div>


      <ul className="cards" id="feed-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {shown.map((card) => (
          <li key={card.id}>
            <CardView
              card={card}
              from={from}
              onOpen={() => {
                track('card_tap', { card: card.id })
                setOverlay({ t: 'detail', card })
              }}
            />
          </li>
        ))}
        {filtering && shown.length === 0 && cards.length > 0 && (
          <li className="search-empty">
            <p>
              {query.trim() ? `За «${query.trim()}»` : 'За цими фільтрами'} нічого{' '}
              {tab === 'events' ? 'серед планів' : 'серед людей'}.
            </p>
            {radiusOn && filters.radius! < 5 && (
              <button className="dlink" onClick={() => setFilters({ ...filters, radius: filters.radius === 1 ? 3 : 5 })}>
                Розширити до {filters.radius === 1 ? 3 : 5} км
              </button>
            )}
            <button className="dbtn" onClick={() => setOverlay({ t: 'create' })}>
              {tab === 'events' ? 'Створити такий план' : 'Написати, що хочу'}
            </button>
            <button
              className="dlink"
              onClick={() => {
                setQuery('')
                setFilters({ radius: null, cats: [] })
              }}
            >
              Показати все
            </button>
          </li>
        )}
        {cards.length === 0 && (
        <li>
          <FeedEnd
            area={profile.areas?.[0]}
            kind={tab}
            onCreate={() => setOverlay({ t: 'create' })}
          />
        </li>
        )}
      </ul>

      <Dock tab={tab} onTab={switchTab} onCreate={() => setOverlay({ t: 'create' })} />

      {overlay?.t === 'filters' && (
        <FiltersSheet
          value={filters}
          available={TAGS.filter((t) => cards.some((c) => c.tags.includes(t)))}
          withRadius
          canRadius={Boolean(from)}
          placeLabel={spot.label}
          count={(f) =>
            filterByQuery(cards, query).filter((c) => {
              if (f.cats.length && !c.tags.some((t) => f.cats.includes(t))) return false
              if (f.radius !== null && from) {
                const pt = cardPoint(c)
                return pt ? distanceKm(from, pt) <= f.radius : false
              }
              return true
            }).length
          }
          onLocate={() => {
            here.request()
            setOverlay(null)
          }}
          onClose={() => setOverlay(null)}
          onApply={(f) => {
            setFilters(f)
            setOverlay(null)
          }}
        />
      )}
      {overlay?.t === 'spot' && (
        <SpotPicker
          current={spot}
          onClose={() => {
            track('spot_pick', { city: getSpot().key, mode: getSpot().mode })
            setOverlay(null)
          }}
        />
      )}
      {overlay?.t === 'notifs' && (
        <NotificationsPage
          items={notifs.items}
          seen={pageSeen}
          onBack={() => setOverlay(null)}
          onOpen={openNotif}
        />
      )}
      {overlay?.t === 'detail' && (
        <DetailSheet
          card={[...realPosts, ...people, ...events].find((c) => c.id === overlay.card.id) ?? overlay.card}
          from={from}
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
          onSend={(place, time, geo) => sendInvite(overlay.card, place, time, geo)}
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
          safety={safety?.matchId === overlay.match.id ? safety : null}
          onSafety={() => setOverlay({ t: 'safety', match: overlay.match })}
          onSafetyBot={() => setOverlay({ t: 'safety-bot', match: overlay.match })}
          onSafetyOff={() => {
            stopSafety()
            track('safety_off')
            say('Підстраховку вимкнено. Довіреним людям написали, що все добре')
          }}
          onClose={() => setOverlay(null)}
          onCancel={(free) => {
            track('match_cancel', { free, real: Boolean(overlay.match.reqId) })
            if (overlay.match.reqId) cancelMeetingApi(overlay.match.reqId, false).then(refreshPosts)
            setMatches((l) => l.filter((m) => m.id !== overlay.match.id))
            setOverlay(null)
            say(free ? 'Зустріч скасовано' : 'Зустріч скасовано. Це вплине на рейтинг')
          }}
          onUncomfortable={() => {
            track('uncomfortable', { real: Boolean(overlay.match.reqId) })
            if (overlay.match.reqId) cancelMeetingApi(overlay.match.reqId, true).then(refreshPosts)
            setMatches((l) => l.filter((m) => m.id !== overlay.match.id))
            setOverlay(null)
            say('Дякуємо, ми перевіримо. Скасовано без штрафу')
          }}
          onTelegram={() =>
            overlay.match.contact
              ? window.open(overlay.match.contact, '_blank', 'noopener')
              : say('Це демо-картка: у справжньому матчі тут відкриється чат у Telegram')
          }
        />
      )}
      {overlay?.t === 'create' && (
        <CreateSheet
          profile={profile}
          onClose={() => setOverlay(null)}
          onPublish={publish}
        />
      )}
      {overlay?.t === 'posted' && (
        <PostedSheet card={overlay.card} onClose={() => setOverlay(null)} />
      )}
      {overlay?.t === 'safety' && (
        <DarkSheet title="Безпечна зустріч" onClose={() => setOverlay({ t: 'match', match: overlay.match })}>
          <SafetySetup
            matchId={overlay.match.id}
            time={overlay.match.time}
            meeting={{
              time: overlay.match.time,
              place: overlay.match.place,
              address: overlay.match.address,
              lat: overlay.match.lat,
              lon: overlay.match.lon,
              withName: overlay.match.with[0]?.name,
              withAge: overlay.match.with[0]?.age || undefined,
            }}
            onProfile={() => setOverlay({ t: 'profile' })}
            onDone={(s: Safety) => {
              track('safety_on', { guardians: s.guardians.length, fence: s.fence, checkAt: s.checkAt })
              setOverlay({ t: 'safety-bot', match: overlay.match })
            }}
          />
        </DarkSheet>
      )}
      {overlay?.t === 'safety-bot' && (
        <DarkSheet title="Останній крок" onClose={() => setOverlay({ t: 'match', match: overlay.match })}>
          <p className="dtext">
            Поділись з ботом геопозицією наживо. Telegram передаватиме її, навіть коли телефон у кишені, і сам
            вимкне через 8 годин.
          </p>
          <ol className="safety-steps">
            <li>Відкрий чат з ботом today</li>
            <li>
              Натисни 📎 → <b>Геопозиція</b>
            </li>
            <li>
              <b>Транслювати геопозицію</b> → 8 годин
            </li>
          </ol>
          <button
            className="dbtn"
            onClick={() => {
              // Real site: opens the bot; the banner turns green once the location arrives
              const demo = setLive()
              track('safety_live')
              setOverlay(null)
              say(
                demo
                  ? `Готово. ${safety ? guardianNames(safety) : 'Довірені люди'} ${safety && safety.guardians.length > 1 ? 'знають' : 'знає'} про зустріч`
                  : 'Поділись геопозицією в боті — і все готово',
              )
            }}
          >
            Відкрити бота
          </button>
          <p className="dhint">У небезпеці — дзвони 112. Підстраховка не замінює екстрені служби.</p>
        </DarkSheet>
      )}
      {overlay?.t === 'profile' && (
        <ProfileSheet
          profile={profile}
          say={say}
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
          onYes={async () => {
            const busy = clash(overlay.inc.time)
            if (busy) return clashSay(busy)
            track('incoming_answer', { yes: true, real: Boolean(overlay.inc.reqId) })
            if (overlay.inc.reqId) {
              const inc = overlay.inc
              const r = await answerRequest(inc.reqId!, true)
              if (!r.ok || !r.match) {
                if (r.error === 'conflict') return say(r.message ?? 'У тебе вже є зустріч на цей час')
                setOverlay(null)
                if (r.message) return say(r.message)
                return say(r.status === 'expired' ? 'Час на відповідь вийшов' : 'На це вже відповіли')
              }
              refreshPosts()
              return addMatch({
                id: `m-${inc.reqId}`,
                reqId: inc.reqId,
                with: [{ name: r.match.name, age: inc.from.age }],
                tag: inc.tag,
                place: inc.place,
                address: inc.address,
                time: inc.time,
                source: 'incoming',
                contact: r.match.contact,
                photo: r.match.photo,
                lat: r.match.lat,
                lon: r.match.lon,
              })
            }
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
            track('incoming_answer', { yes: false, reason, real: Boolean(overlay.inc.reqId) })
            if (overlay.inc.reqId) answerRequest(overlay.inc.reqId, false, reason)
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

/* ---------- Feed filters (remembered for the day) ---------- */

type Filters = { radius: 1 | 3 | 5 | null; cats: string[] }
const FILTERS_KEY = 'today.filters'

function loadFilters(): Filters {
  try {
    const v = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null') as (Filters & { day: string }) | null
    if (v && v.day === new Date().toDateString()) return { radius: v.radius, cats: v.cats }
  } catch {
    /* defaults */
  }
  return { radius: null, cats: [] }
}

function saveFilters(f: Filters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...f, day: new Date().toDateString() }))
  } catch {
    /* memory only */
  }
}

function FiltersSheet({
  value,
  available,
  withRadius,
  canRadius,
  placeLabel,
  count,
  onLocate,
  onClose,
  onApply,
}: {
  value: Filters
  /** Categories that actually occur in this tab of the feed */
  available: string[]
  /** Distance only for plans (free-time posts have no point) */
  withRadius: boolean
  /** Known position or a picked address */
  canRadius: boolean
  placeLabel: string
  count: (f: Filters) => number
  onLocate: () => void
  onClose: () => void
  onApply: (f: Filters) => void
}) {
  const [f, setF] = useState<Filters>(value)
  const toggle = (t: string) =>
    setF((x) => ({ ...x, cats: x.cats.includes(t) ? x.cats.filter((c) => c !== t) : [...x.cats, t] }))
  const n = count(f)
  const any = f.cats.length > 0 || f.radius !== null
  return (
    <DarkSheet title="Фільтри" onClose={onClose}>
      {withRadius && (
        <>
          <p className="dlabel">Як далеко</p>
          <div className="dchips">
            {([null, 1, 3, 5] as const).map((r) => (
              <button
                key={String(r)}
                className={f.radius === r ? 'dchip on' : 'dchip'}
                aria-pressed={f.radius === r}
                disabled={r !== null && !canRadius}
                onClick={() => setF({ ...f, radius: r })}
              >
                {r === null ? 'Будь-де' : `До ${r} км`}
              </button>
            ))}
          </div>
          {!canRadius && (
            <p className="dhint dhint-left">
              Щоб фільтрувати за відстанню,{' '}
              <button className="link-btn" onClick={onLocate}>
                увімкни локацію
              </button>{' '}
              або обери адресу вгорі (📍 {placeLabel}).
            </p>
          )}
        </>
      )}
      {/* Only what's in the feed now (plus anything already picked, so it can be unpicked) */}
      {(() => {
        const shownCats = TAGS.filter((t) => available.includes(t) || f.cats.includes(t))
        return shownCats.length === 0 ? null : (
          <>
      <p className="dlabel">Категорії</p>
      <div className="dchips">
        {shownCats.map((t) => {
          const on = f.cats.includes(t)
          const c = TAG_COLORS[t]
          return (
            <button
              key={t}
              className={on ? 'dchip on' : 'dchip'}
              aria-pressed={on}
              style={on && c ? { background: c.bg, color: c.fg, borderColor: c.bg } : undefined}
              onClick={() => toggle(t)}
            >
              {t}
            </button>
          )
        })}
      </div>
          </>
        )
      })()}
      <button className="dbtn" onClick={() => onApply(f)}>
        {n > 0 ? `Показати ${n}` : 'Нікого за цими фільтрами'}
      </button>
      {any && (
        <button className="dlink" onClick={() => setF({ radius: null, cats: [] })}>
          Скинути все
        </button>
      )}
    </DarkSheet>
  )
}

/* ---------- Sheets ---------- */

/** Place name, short address and time with icons (incoming request, match) */
function PlaceRows({ place, address, time }: { place: string; address?: string; time: string }) {
  return (
    <div className="fcard-meta">
      <div className="fcard-row">
        <PinIcon />
        <div>
          <p className="fcard-venue">{place}</p>
          {address && <p className="fcard-addr">{address}</p>}
        </div>
      </div>
      <p className="fcard-row">
        <ClockIcon />
        <span>{time}</span>
      </p>
    </div>
  )
}

function DetailSheet({
  card,
  from,
  onClose,
  onInvite,
  onJoin,
  onDelete,
}: {
  card: FeedCard
  from?: Coords | null
  onClose: () => void
  onInvite: () => void
  onJoin: () => void
  onDelete: () => void
}) {
  const left = (card.capacity ?? 0) - (card.taken ?? 0)
  return (
    <DarkSheet title={card.kind === 'person' ? 'Покличте мене' : 'Кличу з собою'} onClose={onClose}>
      <div className="dsheet-card">
        <CardView card={card} from={from} showTags />
      </div>
      {card.lat !== undefined && card.lon !== undefined ? (
        <Suspense fallback={<div className="dmap" />}>
          <DetailMap
            point={{ lat: card.lat, lon: card.lon }}
            me={from}
            href={mapsLink({ lat: card.lat, lon: card.lon })}
          />
        </Suspense>
      ) : card.near ? (
        <Suspense fallback={<div className="dmap" />}>
          <DetailMap point={card.near} area={!card.near.exact} me={from} />
        </Suspense>
      ) : null}
      {card.mine ? (
        <button className="dbtn dbtn-ghost" onClick={onDelete}>
          Видалити пост
        </button>
      ) : card.kind === 'person' ? (
        <>
          <button className="dbtn" onClick={onInvite}>
            Покликати
          </button>
          <p className="dhint">Ім’я та фото побачиш після того, як людина скаже «Так».</p>
        </>
      ) : (
        <>
          <button className="dbtn" onClick={onJoin} disabled={left <= 0}>
            {left <= 0 ? 'Місць немає' : left === 1 ? 'Я з вами' : `Я з вами · ще ${left} ${placesWord(left)}`}
          </button>
          <p className="dhint">Організатор підтвердить запит, і відкриється чат.</p>
        </>
      )}
    </DarkSheet>
  )
}

/** 1 місце, 2–4 місця, 5+ місць */
function placesWord(n: number) {
  const d = n % 10
  const t = n % 100
  if (d === 1 && t !== 11) return 'місце'
  if (d >= 2 && d <= 4 && (t < 12 || t > 14)) return 'місця'
  return 'місць'
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
  onSend: (place: string, time: string, geo?: Place) => void
}) {
  const key = getSpot().key
  // Quick places only where we know the city; elsewhere the map picker
  const known = key === 'kharkiv' ? KHARKIV_VENUES : isHomeCity({ key }) ? VENUES : {}
  const suggestions = [...new Set(card.tags.flatMap((t) => known[t] ?? []))].slice(0, 4)
  const slots = slotsFor(card.time)
  const [place, setPlace] = useState<string | null>(null)
  const [geo, setGeo] = useState<Place | null>(null)
  const [picking, setPicking] = useState(false)
  const [time, setTime] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const finalPlace = place === 'map' ? (geo?.name ?? null) : place
  const submit = () => {
    if (!finalPlace) return setError('Обери місце')
    if (!time) return setError('Обери час')
    onSend(finalPlace, time, place === 'map' ? (geo ?? undefined) : undefined)
  }

  return (
    <DarkSheet title="Покликати" onClose={onClose}>
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
          className={place === 'map' ? 'dchip on' : 'dchip'}
          aria-pressed={place === 'map'}
          onClick={() => {
            setError(null)
            setPicking(true)
          }}
        >
          {place === 'map' && geo ? `📍 ${geo.name}` : 'Інше місце на карті'}
        </button>
      </div>
      {picking && (
        <Suspense fallback={null}>
          <PlacePicker
            initial={geo}
            onClose={() => setPicking(false)}
            onPick={(p) => {
              setGeo(p)
              setPlace('map')
              setPicking(false)
            }}
          />
        </Suspense>
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

function Avatar({ name, photo }: { name: string; photo?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="avatar" aria-hidden="true">
      {photo && !failed ? <img src={photo} alt="" onError={() => setFailed(true)} /> : name[0]}
    </span>
  )
}

function MatchSheet({
  match,
  safety,
  onSafety,
  onSafetyBot,
  onSafetyOff,
  onClose,
  onCancel,
  onUncomfortable,
  onTelegram,
}: {
  match: Match
  safety: Safety | null
  onSafety: () => void
  onSafetyBot: () => void
  onSafetyOff: () => void
  onClose: () => void
  onCancel: (free: boolean) => void
  onUncomfortable: () => void
  onTelegram: () => void
}) {
  const { left, label } = useCountdown(FREE_CANCEL_SECONDS)
  const { enabled: safetyOn } = useSafetyStore()
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
        <Avatar name={p.name} photo={match.photo} />
        <div>
          <p className="match-name">
            {p.age > 0 ? `${p.name}, ${p.age}` : p.name}
          </p>
          <p className="dtext dsmall">
            {match.source === 'event' ? 'Автор плану' : 'Зустріч підтверджено'}
          </p>
        </div>
      </div>
      <div className="match-plan">
        <p>
          <TagPill tag={match.tag} size="lg" />
        </p>
        <PlaceRows place={match.place} address={match.address} time={`Сьогодні о ${match.time}`} />
        {match.lat !== undefined && match.lon !== undefined && (
          <a className="route-link" href={mapsLink({ lat: match.lat, lon: match.lon })} target="_blank" rel="noopener">
            Маршрут
          </a>
        )}
      </div>
      <button className="dbtn" onClick={onTelegram}>
        Написати в Telegram
      </button>
      {!safetyOn ? null : !safety ? (
        <button className="safety-cta" onClick={onSafety}>
          <span aria-hidden="true">🛡</span>
          <span>
            <b>Безпечна зустріч</b>
            Довірена людина знатиме, де ти, поки йде зустріч
          </span>
        </button>
      ) : (
        <div className="safety-on">
          <span className={safety.live ? 'safety-dot' : 'safety-dot off'} aria-hidden="true" />
          <span>
            <b>{safety.live ? 'Підстраховка увімкнена' : 'Залишився один крок'}</b>
            {safety.live
              ? `${guardianNames(safety)} знає, де ти, до ${safety.until}. «Все добре?» о ${safety.checkAt}.`
              : 'Поділись геопозицією з ботом'}
          </span>
          {safety.live ? (
            <button className="dlink" onClick={onSafetyOff}>
              Вимкнути
            </button>
          ) : (
            <button className="dlink" onClick={onSafetyBot}>
              Далі
            </button>
          )}
        </div>
      )}
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
  const { left, label } = useCountdown(
    inc.expiresAt ? Math.max(1, Math.round((inc.expiresAt - Date.now()) / 1000)) : ANSWER_SECONDS,
  )
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
        <PlaceRows place={inc.place} address={inc.address} time={`Сьогодні о ${inc.time}`} />
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


function ProfileSheet({
  profile,
  onSignOut,
  onClose,
  onSave,
  say,
}: {
  profile: Profile
  say: (text: string) => void
  onSignOut: () => void
  onClose: () => void
  onSave: (p: Profile) => void
}) {
  const { enabled: safetyOn } = useSafetyStore()
  // The feature may have been switched on after the page loaded
  useEffect(() => {
    syncSafety()
  }, [])
  const [bio, setBio] = useState(profile.bio)
  const [ga, setGa] = useState<Pick<Profile, 'gender' | 'age'>>({
    gender: profile.gender,
    age: profile.age,
  })
  const [places, setPlaces] = useState<Near[]>(profile.places ?? [])
  const [radius, setRadius] = useState(profile.radius ?? 5)
  const [notify, setNotify] = useState(profile.notify !== false)
  const [error, setError] = useState<string | null>(null)
  return (
    <DarkSheet title="Профіль" onClose={onClose}>
      <p className="dtext dsmall">
        Це бачать усі на твоїх постах. Ім’я та фото з Telegram відкриваються тільки після матчу.
      </p>
      <label className="dlabel" htmlFor="p-bio">
        Про себе
      </label>
      <textarea
        id="p-bio"
        className="dinput dinput-bio"
        rows={3}
        maxLength={80}
        placeholder="Чим займаєшся, що любиш"
        value={bio}
        onChange={(e) => setBio(e.target.value.replace(/\s*\n\s*/g, ' '))}
      />
      <p className="dlabel">
        Стать і вік <span className="dopt">необов’язково</span>
      </p>
      <GenderAge gender={ga.gender} age={ga.age} onChange={setGa} />
      {safetyOn && <TrustedSection onAgreed={(name) => say(`${name}: «+». Тепер це твоя довірена людина`)} />}
      <p className="dlabel">
        Мої місця <span className="dopt">до 2, наприклад дім і робота</span>
      </p>
      {places.map((pl, i) => (
        <div className="my-place" key={pl.lat + ':' + pl.lon}>
          <span>
            <PinIcon /> {pl.label}
          </span>
          <button className="dlink" onClick={() => setPlaces(places.filter((_, j) => j !== i))}>
            Прибрати
          </button>
        </div>
      ))}
      {places.length < 2 && (
        <NearField
          value={null}
          placeholder={places.length ? 'Додати ще одне місце' : 'Додай місце, звідки тобі зручно'}
          onChange={(n) => {
            setPlaces([...places, n])
            setError(null)
          }}
        />
      )}
      {error && <p className="derror">{error}</p>}
      <button
        className={notify ? 'dtoggle on' : 'dtoggle'}
        role="switch"
        aria-checked={notify}
        onClick={() => setNotify(!notify)}
      >
        <span className="dtoggle-text">
          <b>Нові плани поруч</b>
          <span>Бот напише, коли поруч з твоїми місцями хтось шукає компанію. Не частіше 2 разів на день.</span>
        </span>
        <span className="dtoggle-knob" aria-hidden="true" />
      </button>
      {notify && (
        <>
          <p className="dlabel">Як далеко від моїх місць</p>
          <ReachChips value={radius} onChange={setRadius} />
        </>
      )}
      <button
        className="dbtn"
        onClick={() => {
          if (notify && places.length === 0) return setError('Додай хоча б одне місце, щоб бот знав, що «поруч»')
          const areas = places.map((pl) => nearestArea(pl.lat, pl.lon) ?? 'Все місто')
          onSave({ ...profile, ...ga, bio: bio.trim(), areas, places, radius, notify })
        }}
      >
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
  onClose,
  onPublish,
}: {
  profile: Profile
  onClose: () => void
  onPublish: (card: FeedCard) => void
}) {
  const [kind, setKind] = useState<'person' | 'event'>('person')
  const [headline, setHeadline] = useState('')
  const [from, setFrom] = useState('18:00')
  const [to, setTo] = useState('21:00')
  const [at, setAt] = useState('20:00')
  const [areas, setAreas] = useState<string[]>(['Все місто'])
  const [venue, setVenue] = useState<Place | null>(null)
  const [picking, setPicking] = useState(false)
  // Free time: roughly where I'll be, from my places or the feed's «Звідки»
  const spotNow = getSpot()
  const [near, setNear] = useState<Near | null>(
    profile.places?.[0] ??
      (spotNow.precise ? { ...roundPoint({ lat: spotNow.lat, lon: spotNow.lon }), label: spotNow.label } : null),
  )
  const [reach, setReach] = useState(5)
  /** How many people the author is looking for (not counting themselves) */
  const [seats, setSeats] = useState(1)
  const [tags, setTags] = useState<string[]>([])
  /** Tags added from the text, not by hand */
  const [auto, setAuto] = useState<string[]>([])
  /** Auto tags the person removed: never re-add them */
  const [removed, setRemoved] = useState<string[]>([])
  // The post shows the profile's «про себе»; it's edited in the profile, not here.
  const bio = profile.bio
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
    if (k === 'event') setAreas(venue ? [venue.area ?? 'Все місто'] : ['Все місто'])
    applyText(headline, k, k === 'event' ? tags.slice(0, 1) : tags, auto)
  }

  const submit = () => {
    if (!headline.trim()) return setError('Напиши кілька слів про план')
    if (tags.length === 0) return setError('Обери категорію')
    if (kind === 'person' && to <= from) return setError('Кінець має бути пізніше за початок')
    if (kind === 'event' && !venue) return setError('Обери місце')
    if (kind === 'person' && !near) return setError('Покажи, звідки тобі зручно')
    const finalBio = bio.trim()
    track('post_create', { kind, autoTags: auto, manualTags: tags.filter((t) => !auto.includes(t)) })
    onPublish({
      id: `mine-${Date.now()}`,
      kind,
      headline: headline.trim(),
      bio: finalBio,
      time: kind === 'person' ? `${from} - ${to}` : at,
      place: kind === 'person' && near ? near.label : formatAreas(areas),
      // Districts only as an old-style hint for pings (Lviv); the point decides now
      areas: kind === 'person' && near ? [nearestArea(near.lat, near.lon) ?? 'Все місто'] : areas,
      ...(kind === 'person' && near ? { near, reach } : {}),
      venue: kind === 'event' ? venue?.name : undefined,
      ...(kind === 'event' && venue
        ? {
            venueAddress: venue.address || undefined,
            ...(Number.isFinite(venue.lat) ? { lat: venue.lat, lon: venue.lon } : {}),
          }
        : {}),
      tags,
      name: 'Ти',
      age: profile.age ?? 0,
      gender: profile.gender,
      taken: kind === 'event' ? 1 : undefined,
      capacity: kind === 'event' ? seats + 1 : undefined,
      mine: true,
    })
  }

  return (
    <DarkSheet title="Новий пост" full onClose={onClose}>
      <div className="dseg" role="tablist" aria-label="Тип поста">
        <button
          role="tab"
          aria-selected={kind === 'person'}
          className={kind === 'person' ? 'on' : ''}
          onClick={() => switchKind('person')}
        >
          Покличте мене
        </button>
        <button
          role="tab"
          aria-selected={kind === 'event'}
          className={kind === 'event' ? 'on' : ''}
          onClick={() => switchKind('event')}
        >
          Кличу з собою
        </button>
      </div>

      <label className="dlabel" htmlFor="c-headline">
        {kind === 'person' ? 'Що хочеш сьогодні?' : 'Який план?'}
      </label>
      <textarea
        id="c-headline"
        className="dinput dtextarea"
        rows={5}
        maxLength={160}
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
      <p className="dhint dhint-left dcount">{headline.length}/160</p>

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

      <p className="dlabel">{kind === 'person' ? 'Коли можеш' : 'Коли'}</p>
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

      {/* Free time has no venue yet: a rough point + how far I'd go */}
      {kind === 'person' && (
        <>
          <p className="dlabel">Звідки ти</p>
          <NearField
            value={near}
            onChange={(n) => {
              setNear(n)
              setError(null)
            }}
          />
          {profile.places && profile.places.length > 1 && (
            <div className="dchips dchips-gap">
              {profile.places.map((pl) => (
                <button
                  key={pl.label + pl.lat}
                  className={near?.lat === pl.lat && near?.lon === pl.lon ? 'dchip dchip-small on' : 'dchip dchip-small'}
                  onClick={() => setNear(pl)}
                >
                  {pl.label}
                </button>
              ))}
            </div>
          )}
          <p className="dlabel">Готовий доїхати</p>
          <ReachChips value={reach} onChange={setReach} />
        </>
      )}

      {kind === 'event' && (
        <>
          <p className="dlabel">Місце</p>
          <button className={venue ? 'place-btn' : 'place-btn empty'} onClick={() => setPicking(true)}>
            <b>{venue ? `📍 ${venue.name}` : 'Обрати на карті'}</b>
            <span>{venue ? venue.address || 'Змінити' : 'Кав’ярня, бар, парк: тільки публічні місця'}</span>
          </button>
          {picking && (
            <Suspense fallback={null}>
              <PlacePicker
                initial={venue}
                onClose={() => setPicking(false)}
                onPick={(p) => {
                  setVenue(p)
                  setPicking(false)
                  setError(null)
                  // Kept for old-style pings only; not shown
                  setAreas([p.area ?? 'Все місто'])
                }}
              />
            </Suspense>
          )}
          <p className="dlabel">Скільки людей шукаєш</p>
          <div className="dchips" role="radiogroup" aria-label="Скільки людей шукаєш">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={seats === n}
                className={seats === n ? 'dchip on' : 'dchip'}
                onClick={() => setSeats(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="dsheet-foot">
        {error && (
          <p className="derror" role="alert">
            {error}
          </p>
        )}
        <button className="dbtn" onClick={submit}>
          Опублікувати
        </button>
      </div>
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
          { text: kind === 'people' ? 'будь першим' : 'поклич з собою', tag: 'Ігри' },
        ]}
      />
      <p className="feed-end-text">
        Поки нікого{where} на сьогодні. Напиши, що хочеш, і люди побачать твій план першим.
      </p>
      <button className="dbtn" onClick={onCreate}>
        {kind === 'people' ? 'Покличте мене' : 'Кличу з собою'}
      </button>
    </div>
  )
}
