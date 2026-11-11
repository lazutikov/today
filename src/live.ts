/**
 * The shared, real side of the app: posts other people see, and invites that
 * reach a real person through the bot. Fake demo cards never touch this.
 */
import type { FeedCard } from './feed'
import type { Profile } from './profile'
import { loadSession } from './telegram'

export const isLive = () => Boolean(loadSession())

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${loadSession() ?? ''}`, ...(init.headers || {}) },
  })
  const body = await res.json().catch(() => ({ ok: false, error: 'bad_response' }))
  return body as T
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
    time: string
    tag: string
  } | null
}

export async function sendRequest(
  postId: string,
  extra: { place?: string; time?: string },
  profile: Profile,
): Promise<{ ok: true; request: ReqStatus } | { ok: false; error: string }> {
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
): Promise<{ ok: boolean; status?: string; match?: ReqStatus['match'] }> {
  return api('/api/requests', { method: 'POST', body: JSON.stringify({ id, answer: yes ? 'yes' : 'no', reason }) })
}
