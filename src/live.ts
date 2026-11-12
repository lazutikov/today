/**
 * The shared, real side of the app: posts other people see, and invites that
 * reach a real person through the bot. Fake demo cards never touch this.
 */
import type { FeedCard } from './feed'
import type { Profile } from './profile'
import { loadSession } from './telegram'
import { track } from './track'

export const isLive = () => Boolean(loadSession())

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${loadSession() ?? ''}`, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({ ok: false, error: 'bad_response' }))
  if (res.status >= 500 || (body as { error?: string }).error === 'bad_response')
    track('api_error', { path: path.split('?')[0], status: res.status })
  return body as T
}

/** Saved profile (any device) plus an age hint from the Telegram birthday. */
export async function fetchMe(): Promise<{ profile: (Profile & { updatedAt?: number }) | null; age: number | null }> {
  const r = await api<{ ok: boolean; profile?: (Profile & { updatedAt?: number }) | null; age?: number | null }>('/api/me')
  return r.ok ? { profile: r.profile ?? null, age: r.age ?? null } : { profile: null, age: null }
}

export async function saveProfileRemote(p: Profile, city: string) {
  if (!isLive()) return
  await api('/api/me', { method: 'POST', body: JSON.stringify({ ...p, city }) })
}

export type Meeting = {
  id: string
  name: string
  age: number
  contact: string
  photo: string
  tag: string
  place: string
  address?: string
  time: string
  post: string
  postId?: string
  source: 'invite' | 'event' | 'incoming'
  cancelled: boolean
  lat?: number
  lon?: number
}

/** Today's confirmed meetings, wherever "Так" was tapped (app or bot). */
export async function fetchMeetings(): Promise<Meeting[]> {
  const r = await api<{ ok: boolean; meetings?: Meeting[] }>('/api/requests?meetings=1')
  return r.ok && r.meetings ? r.meetings : []
}

export async function cancelMeetingApi(id: string, uncomfortable: boolean) {
  await api('/api/requests', { method: 'POST', body: JSON.stringify({ id, cancel: true, uncomfortable }) })
}

export type Notif = {
  id: string
  type: 'request' | 'match' | 'declined' | 'expired' | 'cancelled'
  at: number
  reqId: string
  postId: string
  post: string
  tag: string
  place: string
  time: string
  who: string
  kind?: 'invite' | 'join'
  expiresAt?: number
}

export async function fetchNotifs(): Promise<{ items: Notif[]; seen: number }> {
  const r = await api<{ ok: boolean; items?: Notif[]; seen?: number }>('/api/requests?notifications=1')
  return r.ok ? { items: r.items ?? [], seen: r.seen ?? 0 } : { items: [], seen: 0 }
}

export async function markNotifsSeen() {
  await api('/api/requests', { method: 'POST', body: JSON.stringify({ seen: true }) })
}

export async function fetchPosts(city: string): Promise<FeedCard[]> {
  const r = await api<{ ok: boolean; posts?: FeedCard[] }>(`/api/posts?city=${city}`)
  return r.ok && r.posts ? r.posts : []
}

export async function createPost(card: FeedCard, city: string): Promise<FeedCard | null> {
  const r = await api<{ ok: boolean; post?: FeedCard }>('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ ...card, city }),
  })
  return r.ok && r.post ? r.post : null
}

export async function removePost(id: string) {
  await api('/api/posts?id=' + encodeURIComponent(id), { method: 'DELETE' })
}

export type ReqStatus = {
  id: string
  status: 'pending' | 'yes' | 'no' | 'expired'
  expiresAt: number
  match: {
    name: string
    username: string | null
    contact: string
    photo?: string
    place: string
    address?: string
    time: string
    tag: string
    lat?: number
    lon?: number
  } | null
}

export async function sendRequest(
  postId: string,
  extra: { place?: string; time?: string; lat?: number; lon?: number; address?: string },
  profile: Profile,
): Promise<{ ok: true; request: ReqStatus } | { ok: false; error: string; message?: string }> {
  return api('/api/requests', {
    method: 'POST',
    body: JSON.stringify({ postId, ...extra, bio: profile.bio, gender: profile.gender, age: profile.age }),
  })
}

export async function requestStatus(id: string): Promise<ReqStatus | null> {
  const r = await api<{ ok: boolean; request?: ReqStatus }>(`/api/requests?id=${id}`)
  return r.ok && r.request ? r.request : null
}

export type InboxItem = {
  id: string
  type: 'invite' | 'join'
  post: string
  tag: string
  place: string
  address?: string
  time: string
  from: { gender: string | null; age: number; bio: string }
  expiresAt: number
}

export async function fetchInbox(): Promise<InboxItem[]> {
  const r = await api<{ ok: boolean; inbox?: InboxItem[] }>('/api/requests?inbox=1')
  return r.ok && r.inbox ? r.inbox : []
}

export async function answerRequest(
  id: string,
  yes: boolean,
  reason?: string,
): Promise<{ ok: boolean; status?: string; error?: string; message?: string; match?: ReqStatus['match'] }> {
  return api('/api/requests', { method: 'POST', body: JSON.stringify({ id, answer: yes ? 'yes' : 'no', reason }) })
}

/* ---------- Безпечна зустріч ---------- */

export type TrustedRow = { handle: string; name: string; status: 'wait' | 'ok' | 'no'; label?: string }

export async function fetchTrusted(): Promise<{ ready: boolean; list: TrustedRow[] }> {
  const r = await api<{ ok: boolean; ready?: boolean; list?: TrustedRow[] }>('/api/trusted')
  return { ready: Boolean(r.ready), list: r.list ?? [] }
}
export async function addTrustedApi(handle: string, label?: string): Promise<{ ok: boolean; list?: TrustedRow[]; error?: string }> {
  return api('/api/trusted', { method: 'POST', body: JSON.stringify({ handle, label }) })
}
export async function removeTrustedApi(handle: string) {
  await api(`/api/trusted?handle=${encodeURIComponent(handle)}`, { method: 'DELETE' })
}

export type ServerSafety = {
  matchId: string
  guardians: string[]
  checkAt: number
  until: number
  fence: boolean
  live: boolean
  lastAt: number | null
  asked: string | null
  alarm: string | null
}
export async function fetchSafety(): Promise<{ ready: boolean; safety: ServerSafety | null }> {
  const r = await api<{ ok: boolean; ready?: boolean; safety?: ServerSafety | null }>('/api/safety')
  return { ready: Boolean(r.ready), safety: r.safety ?? null }
}
export async function startSafetyApi(body: Record<string, unknown>): Promise<{ ok: boolean; safety?: ServerSafety; error?: string }> {
  return api('/api/safety', { method: 'POST', body: JSON.stringify({ action: 'start', ...body }) })
}
export async function stopSafetyApi() {
  await api('/api/safety', { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
}
