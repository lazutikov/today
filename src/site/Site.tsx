import { useEffect, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { CITY, CITY_NAME, EVENTS, PEOPLE, TAG_COLORS } from '../feed'
import { isSignedIn } from '../profile'
import { loadSession, startBotLogin } from '../telegram'
import { track } from '../track'
import { CardView, TagPill } from '../ui'
import bowling from './img/bowling.jpg'
import coffee from './img/coffee.jpg'
import dinner from './img/dinner.jpg'
import highfive from './img/highfive.jpg'
import pins from './img/pins.jpg'
import selfie from './img/selfie.jpg'
import walk from './img/walk.jpg'

// On the real deploy the prototype lives at /app; in the Claude artifact preview it is a separate artifact.
const PROTOTYPE_URL =
  (import.meta.env.VITE_POSTHOG_KEY || import.meta.env.VITE_TG_BOT_ID
    ? './app'
    : 'https://claude.ai/artifact/Wo3hscHojHcfzK9qLQKna6') + (CITY === 'warsaw' ? '#warsaw' : '')

const CTA_URL = PROTOTYPE_URL

// One click from the landing: open the bot for "Start" and move this tab to /app, which waits for it.
function goSignIn(e: MouseEvent<HTMLAnchorElement>, where: string) {
  if (isSignedIn() && loadSession()) return track('login_start', { from: where, via: 'already' })
  const bot = startBotLogin()
  track('login_start', { from: where, via: bot ? 'bot' : 'page' })
  if (!bot) return
  e.preventDefault()
  window.open(bot.link, '_blank', 'noopener')
  location.href = `./app?login=${bot.code}${CITY === 'warsaw' ? '#warsaw' : ''}`
}

const PLACE = CITY === 'lviv' ? 'Проспект Свободи' : 'Plac Zbawiciela'

/* ---------- Building blocks ---------- */

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.7 13l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z"
      />
    </svg>
  )
}

function Cta({ where, children }: { where: string; children?: ReactNode }) {
  return (
    <a className="w-cta" href={CTA_URL} onClick={(e) => goSignIn(e, where)}>
      <TelegramIcon />
      {children ?? 'Увійти через Telegram'}
    </a>
  )
}

/**
 * The signature move: a headline set as stacked pills in category colours,
 * the same shape as the tags in the app, with an orange "+" badge.
 */
function Sticker({
  lines,
  as = 'h2',
  id,
  plus = true,
}: {
  lines: { text: string; tag: string }[]
  as?: 'h1' | 'h2'
  id?: string
  plus?: boolean
}) {
  const Tag = as
  return (
    <Tag className="stk" id={id}>
      {lines.map((l, i) => {
        const c = TAG_COLORS[l.tag]
        return (
          <span
            key={l.text}
            className="stk-line"
            style={{ background: c.bg, color: c.fg, '--i': i } as CSSProperties}
          >
            {l.text}
          </span>
        )
      })}
      {plus && (
        <span className="stk-plus" aria-hidden="true">
          +
        </span>
      )}
    </Tag>
  )
}

function InviteCard() {
  return (
    <div className="w-mini" aria-hidden="true">
      <p className="w-mini-kicker">Тебе запрошують</p>
      <p className="w-mini-title">Хочу на каву після роботи</p>
      <TagPill tag="Кава" />
      <p className="w-mini-line">{PLACE}, сьогодні о 19:00</p>
      <div className="w-mini-actions">
        <span className="w-mini-btn ghost">Ні</span>
        <span className="w-mini-btn">Так, 4:59</span>
      </div>
    </div>
  )
}

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function Photo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <img
      className={className ? `w-photo ${className}` : 'w-photo'}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  )
}

/* ---------- Content ---------- */

const PERSONAS = [
  {
    photo: bowling,
    alt: 'Компанія грає в боулінг',
    tag: 'Ігри',
    quote: '«Хочу на боулінг, але не з ким»',
    text: 'Маєш план? Напиши, що, де й о котрій, і поклич людей з собою одним натиском.',
  },
  {
    photo: walk,
    alt: 'Дівчина йде вулицею з квітами й телефоном',
    tag: 'Прогулянка',
    quote: '«Нова в місті, хочеться просто пройтись»',
    text: 'Відміть вільний час і райони. Запрошення прийдуть самі.',
  },
  {
    photo: dinner,
    alt: 'Друзі вечеряють при свічках',
    tag: 'Бар/Ресторан',
    quote: '«Написав трьом — усі зайняті»',
    text: 'Поруч завжди є хтось, хто теж вільний сьогодні ввечері.',
  },
]

const STEPS = [
  { title: 'Напиши, що хочеш', text: '«Вільна 18–21, кава або кіно». Категорії відмітимо самі.' },
  { title: 'Запроси або приєднайся', text: 'Місце й час. У людини є 5 хвилин, щоб відповісти.' },
  { title: 'Зустріньтесь', text: 'Після «Так» відкриваються ім’я та чат у Telegram.' },
]

const FINALLY = [
  { tag: 'Кіно', title: 'Сходити на премʼєру, навіть якщо друзі вже бачили' },
  { tag: 'Спорт', title: 'Пробігти свої 5 км у компанії' },
  { tag: 'Культура', title: 'Не пропустити виставку, бо не було з ким' },
]

const SAFETY = [
  { title: 'Тільки публічні місця', text: 'Кав’ярні, бари, парки, кінотеатри. Ніяких «приходь до мене».' },
  { title: 'Ім’я — після «Так»', text: 'У стрічці немає фото й імен. Вони відкриваються тому, з ким ти погодився.' },
  { title: 'Скасування без пояснень', text: 'Дві хвилини після матчу — безкоштовно. «Мені некомфортно» — завжди.' },
]

const SAFETY_MODE = [
  { title: 'Довірені люди', text: 'Додай до трьох людей. Вони отримають місце, час і посилання на карту, де ти зараз.' },
  { title: '«Все добре?»', text: 'У потрібний момент бот спитає, як ти. Одна кнопка — і ніхто не хвилюється.' },
  { title: 'Далеко від місця — спитаємо', text: 'Відійдеш від місця зустрічі далі, ніж налаштовано? Бот перепитає, чи все гаразд.' },
  { title: 'Не відповідаєш — напишемо', text: 'Немає відповіді чи зв’язку — довірені люди отримають твою останню геопозицію.' },
]

const FAQ = [
  {
    q: 'Що таке Safety mode?',
    a: 'Підстраховка на час зустрічі. Довірені люди знають, де ти, бот питає «Все добре?», а якщо ти не відповідаєш чи зникаєш зі зв’язку — надсилає їм твою останню геопозицію.',
  },
  {
    q: 'Хто бачить мою геопозицію?',
    a: 'Лише люди, яких ти сам(а) додаєш у Safety mode, і лише під час зустрічі. Після неї посилання перестає працювати, а дані видаляються.',
  },
  { q: 'Скільки це коштує?', a: 'На старті — безкоштовно. Спершу хочемо зрозуміти, чи це справді допомагає людям виходити з дому.' },
  { q: 'Чим це відрізняється від Tinder чи Bumble BFF?', a: 'Там шукають людину, тут — план на сьогодні. Без свайпів, фото в стрічці й багатоденних переписок.' },
  { q: 'Чому вхід через Telegram?', a: 'Без пароля і реєстрації. Запрошення приходять повідомленням у Telegram. Номер телефону ми не бачимо.' },
  { q: 'Що інші бачать про мене?', a: 'Твій пост, рядок «про себе» і, якщо хочеш, стать і вік. Ім’я та фото — тільки після матчу.' },
  { q: 'Де це працює?', a: `Запускаємось ${CITY === 'lviv' ? 'у Львові' : 'у Варшаві'} район за районом, щоб поруч завжди були люди.` },
  { q: 'А якщо ніхто не відповість?', a: 'Чесно: на старті людей ще небагато. Тому відкриваємо райони по черзі й підкажемо, де зараз найбільше планів.' },
]

/* ---------- Page ---------- */

export default function Site() {
  useEffect(() => {
    track('landing_view', { page: 'site' })
  }, [])

  return (
    <div className="w">
      <nav className="w-nav" aria-label="Навігація">
        <a className="w-logo" href="#top">
          today
        </a>
        <div className="w-nav-links">
          <a href="#how">Як це працює</a>
          <a href="#safety">Безпека</a>
          <a href="#faq">Питання</a>
        </div>
        <a className="w-nav-cta" href={CTA_URL} onClick={(e) => goSignIn(e, 'nav')}>
          Спробувати
        </a>
      </nav>

      {/* Hero: one photo, giant wordmark sinking into it */}
      <header className="w-hero" id="top">
        <img className="w-hero-img" src={selfie} alt="Друзі роблять селфі в парку" fetchPriority="high" />
        <div className="w-hero-shade" aria-hidden="true" />
        <div className="w-hero-copy">
          <h1 className="w-hero-title">Компанія на сьогодні</h1>
          <p className="w-hero-lead">
            Кава, кіно, боулінг чи прогулянка — з людьми поруч, уже ввечері. {CITY_NAME}.
          </p>
          <Cta where="hero" />
        </div>
        {/* What Safety mode looks like for the trusted person: a glimpse, not a promise of rescue */}
        <a className="w-hero-safe" href="#safety" aria-label="Safety mode: детальніше">
          <span className="w-hero-safe-icon" aria-hidden="true">
            <ShieldMark />
          </span>
          <span className="w-hero-safe-text">
            <b>Safety mode увімкнено</b>
            <span>Подруга знає, де ти, до 22:00</span>
          </span>
          <span className="w-hero-safe-dot" aria-hidden="true" />
        </a>
      </header>

      <section className="w-intro" aria-labelledby="intro-title">
        <Sticker
          id="intro-title"
          lines={[
            { text: 'менше чатів', tag: 'Ігри' },
            { text: 'більше вечорів', tag: 'Кава' },
          ]}
        />
        <div className="w-intro-text">
          <p className="w-text">
            Пишеш, що хочеш сьогодні, і за кілька хвилин маєш план і людей поруч. Без анкет, свайпів
            і тижневих переписок.
          </p>
          <a className="w-safe-note" href="#safety">
            <span className="w-safe-note-icon" aria-hidden="true">
              <ShieldMark />
            </span>
            <span>
              <b>Ми робимо все, щоб тобі було спокійно.</b> Тільки публічні місця, ім’я — після «Так», а Safety
              mode підстрахує під час самої зустрічі.
            </span>
          </a>
        </div>
      </section>

      {/* How it works: the app in a real scene */}
      <section className="w-how" id="how" aria-labelledby="how-title">
        <div className="w-scene">
          <Photo src={coffee} alt="Людина з телефоном і кавою за столиком" className="w-scene-img" />
          <div className="w-scene-card">
            <InviteCard />
          </div>
        </div>
        <div className="w-how-text">
          <Sticker id="how-title" plus={false} lines={[{ text: 'як це працює', tag: 'Спорт' }]} />
          <ol className="w-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="w-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="w-h3">{s.title}</h3>
                  <p className="w-text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Personas: tilted photo cards with a category bubble */}
      <section className="w-section" aria-labelledby="who-title">
        <Sticker
          id="who-title"
          lines={[
            { text: 'для тих, хто', tag: 'Кіно' },
            { text: 'хоче вийти', tag: 'Бар/Ресторан' },
          ]}
        />
        <div className="w-personas">
          {PERSONAS.map((p) => (
            <article key={p.tag} className="w-persona">
              <div className="w-persona-photo">
                <Photo src={p.photo} alt={p.alt} />
                <span className="w-persona-tag">
                  <TagPill tag={p.tag} size="lg" />
                </span>
              </div>
              <p className="w-quote">{p.quote}</p>
              <p className="w-text">{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Bento: "З today ти нарешті…" */}
      <section className="w-section" aria-labelledby="finally-title">
        <Sticker
          id="finally-title"
          lines={[
            { text: 'з today ти', tag: 'Прогулянка' },
            { text: 'нарешті…', tag: 'Ігри' },
          ]}
        />
        <ul className="w-bento">
          <li className="w-tile w-tile-photo w-tile-tall">
            <Photo src={highfive} alt="Друзі сміються й дають п’ять" />
            <p className="w-tile-caption">Познайомишся з людьми, з якими захочеш зустрітись ще раз</p>
          </li>
          <li className="w-tile w-tile-photo w-tile-pins">
            <Photo src={pins} alt="Кеглі розлітаються від кулі" />
            <span className="w-tile-tag">Ігри</span>
            <p className="w-tile-title">Вибити страйк у вівторок, а не «колись»</p>
          </li>
          {FINALLY.map((f) => {
            const c = TAG_COLORS[f.tag]
            return (
              <li key={f.title} className="w-tile" style={{ background: c.bg, color: c.fg }}>
                <span className="w-tile-tag">{f.tag}</span>
                <p className="w-tile-title">{f.title}</p>
              </li>
            )
          })}

        </ul>
      </section>

      {/* Feed preview: the real card */}
      <section className="w-section w-feed" aria-labelledby="feed-title">
        <Sticker id="feed-title" plus={false} lines={[{ text: 'так виглядає стрічка', tag: 'Кава' }]} />
        <div className="w-feed-cards">
          <CardView card={PEOPLE[0]} />
          <CardView card={EVENTS[0]} />
          <CardView card={PEOPLE[2]} />
        </div>
      </section>

      <section className="w-section w-safety" id="safety" aria-labelledby="safety-title">
        <Sticker
          id="safety-title"
          lines={[
            { text: 'безпечно', tag: 'Прогулянка' },
            { text: 'на твоїх умовах', tag: 'Кіно' },
          ]}
        />
        <div className="w-safety-grid">
          {SAFETY.map((s) => (
            <div key={s.title} className="w-safety-card">
              <h3 className="w-h3">{s.title}</h3>
              <p className="w-text">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="w-sm">
          <div className="w-sm-head">
            <span className="w-sm-badge">
              <ShieldMark /> Safety mode
            </span>
            <h3 className="w-sm-title">Підстраховка під час самої зустрічі</h3>
            <p className="w-text">
              Увімкни один раз — і на кожній зустрічі тебе підстраховують люди, яким ти довіряєш. За 10 хвилин до
              початку вони дізнаються, де, коли й з ким ти зустрічаєшся.
            </p>
          </div>
          <ol className="w-sm-steps">
            {SAFETY_MODE.map((s) => (
              <li key={s.title}>
                <b>{s.title}</b>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="w-sm-note">
            Геопозицію бачать лише твої довірені люди і лише під час зустрічі. Safety mode не замінює екстрені
            служби: у небезпеці дзвони 112.
          </p>
        </div>
        <p className="w-promise">Це не дейтинг. Тут обирають не людей, а куди піти сьогодні.</p>
      </section>

      <section className="w-section" id="faq" aria-labelledby="faq-title">
        <Sticker id="faq-title" plus={false} lines={[{ text: 'питання', tag: 'Бар/Ресторан' }]} />
        <div className="w-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="w-faq-item">
              <summary>{f.q}</summary>
              <p className="w-text">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="w-final" aria-labelledby="final-title">
        <img className="w-final-img" src={dinner} alt="" loading="lazy" />
        <div className="w-final-shade" aria-hidden="true" />
        <div className="w-final-copy">
          <Sticker
            id="final-title"
            plus={false}
            lines={[
              { text: 'сьогодні ще', tag: 'Ігри' },
              { text: 'не закінчилось', tag: 'Кава' },
            ]}
          />
          <span className="w-final-cta">
            <Cta where="final">Знайти компанію</Cta>
          </span>
        </div>
      </section>

      <footer className="w-footer">
        <span className="w-logo">today</span>
        <span>
          Прототип, {new Date().getFullYear()}. Люди в прикладах вигадані. Фото: Unsplash (Vitaly
          Gariev, Aleksandra Sapozhnikova, Brittani Burns, Good Faces, Romain Gal, Toa Heftiba, Blend
          Archive).
        </span>
      </footer>
    </div>
  )
}
