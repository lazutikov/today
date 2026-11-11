import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AREAS, MAX_AREAS, TAG_COLORS, WHOLE_CITY, type FeedCard } from './feed'

/* ---------- Icons ---------- */

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'ico',
}

export function UserIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.2 18.4a6.5 6.5 0 0 1 11.6 0" />
    </svg>
  )
}

export function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 21.5s-6.75-5.9-6.75-11.25a6.75 6.75 0 0 1 13.5 0C18.75 15.6 12 21.5 12 21.5Z" />
      <circle cx="12" cy="10.25" r="2.5" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10.25" />
      <path d="M12 7.5v9M7.5 12h9" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

/* ---------- Category pill ---------- */

export function TagPill({ tag, size }: { tag: string; size?: 'lg' }) {
  const c = TAG_COLORS[tag] ?? { bg: '#EBEBEB', fg: '#000000' }
  return (
    <span className={size ? 'tag-pill lg' : 'tag-pill'} style={{ background: c.bg, color: c.fg }}>
      {tag}
    </span>
  )
}

/** «Чоловік, 29» — whatever the author chose to show. */
export function whoLine(card: Pick<FeedCard, 'gender' | 'age'>): string {
  const parts = [card.gender ?? 'Стать не вказана', card.age ? String(card.age) : null].filter(Boolean)
  return parts.join(', ')
}

/* ---------- Card (Figma "Frame 20") ---------- */

export function CardView({ card, onOpen }: { card: FeedCard; onOpen?: () => void }) {
  const who = whoLine(card)
  return (
    <article className={card.mine ? 'fcard mine' : 'fcard'}>
      {onOpen && <button className="fcard-hit" onClick={onOpen} aria-label={card.headline} />}
      {card.mine && <span className="fcard-badge">{card.matched ? 'Твій пост · є матч' : 'Твій пост'}</span>}
      <h2 className="fcard-title">{card.headline}</h2>
      {(card.bio || who) && (
        <div className="fcard-about">
          {card.bio && <p className="fcard-quote">«{card.bio}»</p>}
          {who && <p className="fcard-who">{who}</p>}
        </div>
      )}
      <p className="fcard-when">
        <span>{card.time}</span>
        <span className="fcard-dot" aria-hidden="true" />
        <span>{card.place}</span>
      </p>
      <p className="fcard-pills">
        {card.tags.map((t) => (
          <TagPill key={t} tag={t} />
        ))}
      </p>
    </article>
  )
}

/* ---------- Bottom dock ---------- */

export type Tab = 'events' | 'people'

export function Dock({
  tab,
  onTab,
  onCreate,
}: {
  tab: Tab
  onTab: (t: Tab) => void
  onCreate: () => void
}) {
  return (
    <>
    <div className="dock-fade" aria-hidden="true" />
    <nav className="dock" aria-label="Навігація">
      <div className="segment" role="tablist" aria-label="Стрічка">
        <button
          role="tab"
          id="tab-events"
          aria-selected={tab === 'events'}
          aria-controls="feed-panel"
          className={tab === 'events' ? 'seg on' : 'seg'}
          onClick={() => onTab('events')}
        >
          Плани
        </button>
        <button
          role="tab"
          id="tab-people"
          aria-selected={tab === 'people'}
          aria-controls="feed-panel"
          className={tab === 'people' ? 'seg on' : 'seg'}
          onClick={() => onTab('people')}
        >
          Вільні
        </button>
      </div>
      <button className="fab" aria-label="Створити пост" onClick={onCreate}>
        <PlusIcon />
      </button>
    </nav>
    </>
  )
}

/* ---------- Dark bottom sheet ---------- */

export function DarkSheet({
  title,
  heading,
  tone,
  onClose,
  children,
}: {
  title: string
  /** Replaces the plain title visually (e.g. a sticker); `title` still names the dialog */
  heading?: ReactNode
  tone?: 'dark'
  onClose?: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="dscrim" onClick={onClose}>
      <div
        className={tone === 'dark' ? 'dsheet dsheet-dark' : 'dsheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dsheet-head">
          {heading ?? <h2 className="dsheet-title">{title}</h2>}
          {onClose && (
            <button className="icon-btn" aria-label="Закрити" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- Countdown ---------- */

export function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [])
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  return { left, label: `${mm}:${ss}` }
}

/* ---------- District picker ---------- */

/**
 * Multi-select (up to MAX_AREAS) or single-select district chips.
 * The whole-city option excludes the others, and the other way round.
 */
export function AreaPicker({
  value,
  multi,
  onChange,
  onError,
}: {
  value: string[]
  multi: boolean
  onChange: (next: string[]) => void
  onError: (msg: string | null) => void
}) {
  const toggle = (a: string) => {
    onError(null)
    if (!multi) return onChange([a])
    if (value.includes(a)) return onChange(value.filter((x) => x !== a))
    if (a === WHOLE_CITY) return onChange([a])
    const rest = value.filter((x) => x !== WHOLE_CITY)
    if (rest.length >= MAX_AREAS) return onError(`Не більше ${MAX_AREAS} районів`)
    onChange([...rest, a])
  }
  return (
    <div className="dchips" role="group">
      {AREAS.map((a) => {
        const on = value.includes(a)
        return (
          <button
            key={a}
            className={on ? 'dchip on' : 'dchip'}
            aria-pressed={on}
            onClick={() => toggle(a)}
          >
            {a}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Gender & age (optional, shown on posts as «Чоловік, 29») ---------- */

const GENDERS = ['Чоловік', 'Жінка'] as const

export function GenderAge({
  gender,
  age,
  onChange,
}: {
  gender?: 'Чоловік' | 'Жінка'
  age?: number
  onChange: (next: { gender?: 'Чоловік' | 'Жінка'; age?: number }) => void
}) {
  return (
    <>
      <div className="dchips" role="group" aria-label="Стать">
        {GENDERS.map((g) => (
          <button
            key={g}
            className={gender === g ? 'dchip on' : 'dchip'}
            aria-pressed={gender === g}
            onClick={() => onChange({ gender: g, age })}
          >
            {g}
          </button>
        ))}
        <button
          className={!gender ? 'dchip on' : 'dchip'}
          aria-pressed={!gender}
          onClick={() => onChange({ gender: undefined, age })}
        >
          Не вказувати
        </button>
      </div>
      <input
        className="dinput dinput-age"
        inputMode="numeric"
        aria-label="Вік"
        placeholder="Вік, необов’язково"
        maxLength={2}
        value={age ?? ''}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
          onChange({ gender, age: Number.isFinite(n) ? n : undefined })
        }}
      />
    </>
  )
}

/* ---------- Sticker headline (shared with the landing) ---------- */

/** A headline set as stacked pills in category colours, with an optional orange "+". */
export function Sticker({
  lines,
  as = 'h2',
  plus = true,
  size,
}: {
  lines: { text: string; tag: string }[]
  as?: 'h1' | 'h2' | 'p'
  plus?: boolean
  size?: 'sm' | 'lg'
}) {
  const Tag = as
  return (
    <Tag className={size ? `astk astk-${size}` : 'astk'}>
      {lines.map((l, i) => {
        const c = TAG_COLORS[l.tag] ?? { bg: '#EBEBEB', fg: '#000000' }
        return (
          <span
            key={l.text}
            className="astk-line"
            style={{ background: c.bg, color: c.fg, '--i': i } as CSSProperties}
          >
            {l.text}
          </span>
        )
      })}
      {plus && (
        <span className="astk-plus" aria-hidden="true">
          +
        </span>
      )}
    </Tag>
  )
}
