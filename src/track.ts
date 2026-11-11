/**
 * Event tracking. Every event gets the traffic source (?src=...) and a session id.
 * With VITE_POSTHOG_KEY set, events go to PostHog (EU); otherwise to the console
 * and localStorage, so the artifact preview keeps working without keys.
 */
import posthog from 'posthog-js'

const PH_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
let phReady = false
if (PH_KEY && typeof window !== 'undefined') {
  try {
    posthog.init(PH_KEY, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: true,
      persistence: 'localStorage',
    })
    phReady = true
    const inTelegram = Boolean(
      (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData,
    )
    posthog.register({ entry: inTelegram ? 'telegram' : 'site' })
  } catch {
    /* analytics must never break the UI */
  }
}

/** Ties the anonymous session to a Telegram user after login. */
export function identify(id: string, props: Record<string, unknown> = {}) {
  if (phReady) posthog.identify(id, props)
}

export function resetIdentity() {
  if (phReady) posthog.reset()
}

const SESSION_KEY = 'today.session'
const SRC_KEY = 'today.src'

function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return 'nostorage'
  }
}

export function source(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('src')
    if (fromUrl) localStorage.setItem(SRC_KEY, fromUrl)
    return fromUrl || localStorage.getItem(SRC_KEY) || 'direct'
  } catch {
    return 'direct'
  }
}

export type EventName =
  | 'feed_view'
  | 'tab_switch'
  | 'card_tap'
  | 'card_cta'
  | 'login_start'
  | 'survey_submit'
  | 'share_tap'
  | 'invite_send'
  | 'invite_result'
  | 'join_request'
  | 'post_create'
  | 'post_delete'
  | 'incoming_answer'
  | 'match'
  | 'match_cancel'
  | 'uncomfortable'
  | 'profile_save'
  | 'landing_view'
  | 'onboarding_done'
  | 'sign_out'
  | 'login_success'
  | 'join_result'
  | 'incoming_view'
  | 'age_hint'
  | 'notifs_open'
  | 'profile_restored'
  | 'deep_link'
  | 'spot_auto'
  | 'spot_pick'
  | 'feed_search'
  | 'notif_tap'
  | 'login_error'

export function track(name: EventName, props: Record<string, unknown> = {}) {
  const event = {
    name,
    props,
    src: source(),
    session: sessionId(),
    at: new Date().toISOString(),
  }
  console.info('[track]', event)
  send(event)
}

async function send(event: { name: string; props: Record<string, unknown>; src: string; session: string }) {
  if (phReady) {
    posthog.capture(event.name, { ...event.props, src: event.src, city: location.hash.replace('#', '') === 'warsaw' ? 'warsaw' : 'lviv' })
    return
  }
  try {
    const log = JSON.parse(localStorage.getItem('today.events') || '[]')
    log.push(event)
    localStorage.setItem('today.events', JSON.stringify(log.slice(-200)))
  } catch {
    /* storage may be unavailable; tracking must never break the UI */
  }
}
