/**
 *  POST /api/requests {postId, place?, time?, gender?, age?, bio?}   invite a person / ask to join an event
 *  POST /api/requests {id, answer: 'yes'|'no', reason?}               answer one sent to you
 *  GET  /api/requests?id=...                                          status of the one you sent
 *  GET  /api/requests?inbox=1                                         pending ones sent to you
 *  GET  /api/requests?meetings=1                                      today's confirmed meetings
 *  POST /api/requests {id, cancel: true, uncomfortable?}              cancel a confirmed meeting
 *  GET  /api/requests?notifications=1                                 notification feed + last-seen time
 *  POST /api/requests {seen: true}                                    mark notifications read
 */
import { json, kv, readJson, readSession } from './_kv.js'
import {
  answerReq,
  cancelMeeting,
  createReq,
  getPost,
  getReq,
  inboxView,
  listMeetings,
  listNotifs,
  markNotifsSeen,
  matchViewForAuthor,
  reqStatusView,
  settleExpiry,
} from './_social.js'

export async function POST(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const body = await readJson<Record<string, unknown>>(request)
  if (!body) return json({ ok: false, error: 'bad_json' }, 400)

  if (body.seen) {
    await markNotifsSeen(user.id)
    return json({ ok: true })
  }

  if (typeof body.id === 'string' && body.cancel) {
    const res = await cancelMeeting(body.id, user.id, Boolean(body.uncomfortable))
    return json(res, res.ok ? 200 : 409)
  }

  if (typeof body.id === 'string' && (body.answer === 'yes' || body.answer === 'no')) {
    const res = await answerReq(body.id, user.id, body.answer === 'yes', body.reason as string | undefined)
    let match = null
    if (res.ok && res.status === 'yes') {
      const r = await getReq(body.id)
      if (r) match = matchViewForAuthor(r)
    }
    return json({ ...res, match }, res.ok ? 200 : 409)
  }

  const post = typeof body.postId === 'string' ? await getPost(body.postId) : null
  if (!post) return json({ ok: false, error: 'post_gone' }, 404)
  const res = await createReq(user, post, body as { place?: string; time?: string; gender?: string; age?: number; bio?: string })
  if (res.ok === false) return json(res, res.error === 'busy' ? 429 : 409)
  return json({ ok: true, request: reqStatusView(res.req) })
}

export async function GET(request: Request): Promise<Response> {
  const user = readSession(request)
  if (!user) return json({ ok: false, error: 'no_session' }, 401)
  const params = new URL(request.url).searchParams

  if (params.get('notifications')) return json({ ok: true, ...(await listNotifs(user.id)) })
  if (params.get('meetings')) return json({ ok: true, meetings: await listMeetings(user.id) })

  if (params.get('inbox')) {
    const ids = (await kv('ZRANGEBYSCORE', `inbox:${user.id}`, Date.now(), '+inf')) as string[]
    const reqs = await Promise.all(ids.map((id) => getReq(id)))
    return json({ ok: true, inbox: reqs.filter((r) => r && r.status === 'pending').map((r) => inboxView(r!)) })
  }

  const r = await getReq(params.get('id') || '')
  if (!r || r.from.id !== user.id) return json({ ok: false, error: 'not_found' }, 404)
  return json({ ok: true, request: reqStatusView(await settleExpiry(r)) })
}
