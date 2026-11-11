/**
 * Сповіщення: everything the bot sends, kept in the app. Each row leads to
 * the thing it is about (answer a request, open a meeting, open the plan).
 */
import { useEffect, useState } from 'react'
import { TAG_COLORS } from './feed'
import type { Notif } from './live'
import { BackIcon, Sticker } from './ui'

const ICON: Record<Notif['type'], string> = {
  request: '🙋',
  match: '🎉',
  declined: '🙅',
  expired: '⌛',
  cancelled: '↩︎',
}

function title(n: Notif) {
  switch (n.type) {
    case 'request':
      return n.kind === 'join' ? 'Хочуть приєднатися до твого плану' : 'Тебе кличуть'
    case 'match':
      return `Є матч: ${n.who}`
    case 'declined':
      return 'Цього разу ні'
    case 'expired':
      return 'Час на відповідь вийшов'
    case 'cancelled':
      return `${n.who} скасував(ла) зустріч`
  }
}

function ago(at: number, now: number) {
  const min = Math.floor((now - at) / 60000)
  if (min < 1) return 'щойно'
  if (min < 60) return `${min} хв тому`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} год тому`
  return 'вчора'
}

function leftLabel(expiresAt: number, now: number) {
  const s = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function NotificationsPage({
  items,
  seen,
  onBack,
  onOpen,
}: {
  items: Notif[]
  seen: number
  onBack: () => void
  onOpen: (n: Notif) => void
}) {
  // Ticks the "answer within" timers and "5 хв тому" labels
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const fresh = items.filter((n) => n.at > seen)
  const older = items.filter((n) => n.at <= seen)

  const row = (n: Notif) => {
    const live = n.type === 'request' && (n.expiresAt ?? 0) > now
    const color = TAG_COLORS[n.tag]
    return (
      <li key={n.id}>
        <button className={n.at > seen ? 'ncard unread' : 'ncard'} onClick={() => onOpen(n)}>
          <span className="ncard-icon" style={{ background: color?.bg ?? '#EBEBEB' }} aria-hidden="true">
            {ICON[n.type]}
          </span>
          <span className="ncard-body">
            <span className="ncard-title">{title(n)}</span>
            <span className="ncard-post">«{n.post}»</span>
            {n.type === 'request' && n.who && <span className="ncard-who">{n.who}</span>}
            <span className="ncard-meta">
              {n.place} · {n.time}
            </span>
            {live && <span className="ncard-cta">Відповісти · {leftLabel(n.expiresAt!, now)}</span>}
          </span>
          <span className="ncard-time">{ago(n.at, now)}</span>
        </button>
      </li>
    )
  }

  return (
    <div className="npage" role="dialog" aria-modal="true" aria-label="Сповіщення">
      <header className="npage-head">
        <button className="profile-btn" onClick={onBack} aria-label="Назад до стрічки">
          <BackIcon />
        </button>
        <h1 className="npage-title">Сповіщення</h1>
        <span className="npage-spacer" aria-hidden="true" />
      </header>

      {items.length === 0 ? (
        <div className="npage-empty">
          <Sticker
            as="p"
            size="sm"
            lines={[
              { text: 'тут поки', tag: 'Кава' },
              { text: 'тихо', tag: 'Прогулянка' },
            ]}
          />
          <p>Тут з’являться запрошення, матчі й скасування. Бот теж напише в Telegram.</p>
        </div>
      ) : (
        <>
          {fresh.length > 0 && (
            <section>
              <h2 className="npage-group">Нові</h2>
              <ul className="nlist">{fresh.map(row)}</ul>
            </section>
          )}
          {older.length > 0 && (
            <section>
              <h2 className="npage-group">Раніше</h2>
              <ul className="nlist">{older.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
