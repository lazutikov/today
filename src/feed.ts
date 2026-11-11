/**
 * Demo feed in the Figma concept format (frame "Frame 4").
 * Illustrative examples only, not real people.
 */

export type FeedCard = {
  id: string
  kind: 'person' | 'event'
  headline: string
  bio: string
  /** "18:00 - 21:00" for people, "20:00" for events */
  time: string
  place: string
  tags: string[]
  /** Revealed only after a match */
  name: string
  age: number
  /** Shown on the card as «Чоловік, 29» */
  gender?: 'Чоловік' | 'Жінка'
  /** Concrete venue for events */
  venue?: string
  /** Event seats */
  taken?: number
  capacity?: number
  mine?: boolean
  /** Posted by a real person through the server (answers are real too) */
  real?: boolean
  /** Districts as picked (the card shows them joined in `place`) */
  areas?: string[]
  /** Venue picked on the map */
  venueAddress?: string
  lat?: number
  lon?: number
  /** Real free-time post that already has a match (author's view) */
  matched?: boolean
}

export type City = 'warsaw' | 'lviv'

/** City comes from the link: …/#warsaw switches to Warsaw, Lviv by default. */
export const CITY: City = (() => {
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } }).Telegram
    const fromTelegram = tg?.WebApp?.initDataUnsafe?.start_param
    return location.hash.replace('#', '') === 'warsaw' || fromTelegram === 'warsaw' ? 'warsaw' : 'lviv'
  } catch {
    return 'lviv'
  }
})()

export const CITY_NAME = CITY === 'lviv' ? 'Львів' : 'Варшава'

/**
 * Fixed categories: one per kind of plan, no overlaps
 * (beer, wine and dinner are all "Бар/Ресторан").
 */
export const TAGS = ['Кава', 'Бар/Ресторан', 'Прогулянка', 'Кіно', 'Спорт', 'Ігри', 'Культура']

/** Category colours (Figma palette; pastel red replaces orange so tags never look like buttons). */
export const TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  Кава: { bg: '#F2B298', fg: '#000000' },
  'Бар/Ресторан': { bg: '#F07A7A', fg: '#000000' },
  Прогулянка: { bg: '#A7C582', fg: '#000000' },
  Кіно: { bg: '#8376A6', fg: '#000000' },
  Спорт: { bg: '#7BBED4', fg: '#000000' },
  Ігри: { bg: '#FFC018', fg: '#000000' },
  Культура: { bg: '#3A7266', fg: '#FFFFFF' },
}

/** Warsaw districts (dzielnice) in Polish, as people see them on maps and signs. */
const AREAS_WARSAW = [
  'Śródmieście',
  'Mokotów',
  'Wola',
  'Ochota',
  'Żoliborz',
  'Praga-Północ',
  'Praga-Południe',
  'Ursynów',
  'Cała Warszawa',
]

/** Place suggestions for invites, by activity. */
const VENUES_WARSAW: Record<string, string[]> = {
  Кава: ['Plac Zbawiciela', 'Hala Koszyki'],
  'Бар/Ресторан': ['Nowy Świat', 'Hala Koszyki', 'Hala Gwardii'],
  Прогулянка: ['Bulwary Wiślane', 'Łazienki Królewskie'],
  Кіно: ['Kino Muranów', 'Kinoteka, PKiN'],
  Спорт: ['Pole Mokotowskie', 'Park Skaryszewski'],
  Ігри: ['Nowy Świat', 'Plac Politechniki'],
  Культура: ['Muzeum Narodowe', 'Zachęta'],
}

const PEOPLE_WARSAW: FeedCard[] = [
  {
    id: 'person-1',
    kind: 'person',
    headline:
      'Вільний вечір. Поговорю про футбол, IT або ШІ за пляшкою пива або келихом вина',
    bio: 'Полюбляю готувати. Ходжу в зал та в басейн. Люблю джин і лазанью.',
    time: '18:00 - 21:00',
    place: 'Śródmieście, Mokotów',
    tags: ['Бар/Ресторан', 'Прогулянка', 'Кава'],
    name: 'Андрій',
    age: 29,
    gender: 'Чоловік',
  },
  {
    id: 'person-2',
    kind: 'person',
    headline: 'Хочу сходити в кіно на якийсь новий фільм. Можу купити квитки',
    bio: 'Кіноман.',
    time: '20:00 - 23:00',
    place: 'Cała Warszawa',
    tags: ['Кіно', 'Бар/Ресторан', 'Прогулянка'],
    name: 'Марта',
    age: 26,
    gender: 'Жінка',
  },
  {
    id: 'person-3',
    kind: 'person',
    headline: 'Після роботи хочу просто пройтись і випити кави. Нова у Варшаві',
    bio: 'Дизайнерка, переїхала пів року тому.',
    time: '19:00 - 21:30',
    place: 'Mokotów',
    tags: ['Кава', 'Прогулянка'],
    name: 'Олена',
    age: 27,
    gender: 'Жінка',
  },
]

const EVENTS_WARSAW: FeedCard[] = [
  {
    id: 'event-1',
    kind: 'event',
    headline: 'Граємо в більярд о 20:00 на Nowy Świat. Нас двоє, шукаємо ще двох',
    bio: 'Інженер, граю в більярд по пʼятницях. Рівень аматорський.',
    time: '20:00',
    place: 'Śródmieście',
    venue: 'Nowy Świat',
    tags: ['Ігри'],
    name: 'Олег',
    age: 31,
    gender: 'Чоловік',
    taken: 2,
    capacity: 4,
  },
  {
    id: 'event-2',
    kind: 'event',
    headline: 'Настолки біля Plac Politechniki: Codenames і Каркасон. Пояснимо правила',
    bio: 'Студентка, збираю компанію на настолки щотижня.',
    time: '19:30',
    place: 'Śródmieście',
    venue: 'Plac Politechniki',
    tags: ['Ігри'],
    name: 'Іра',
    age: 24,
    gender: 'Жінка',
    taken: 3,
    capacity: 5,
  },
  {
    id: 'event-3',
    kind: 'event',
    headline: 'Легка пробіжка 5 км по Pole Mokotowskie, темп 6:00. Новачкам раді',
    bio: 'Бігаю три роки, готуюсь до півмарафону.',
    time: '19:00',
    place: 'Ochota',
    venue: 'Pole Mokotowskie',
    tags: ['Спорт'],
    name: 'Денис',
    age: 33,
    gender: 'Чоловік',
    taken: 1,
    capacity: 4,
  },
]

/** Demo people who "respond" inside the prototype. */
const INVITERS_WARSAW = [
  { name: 'Софія', age: 25, tag: 'Кава', place: 'Plac Zbawiciela' },
  { name: 'Максим', age: 28, tag: 'Бар/Ресторан', place: 'Nowy Świat' },
  { name: 'Ліза', age: 30, tag: 'Прогулянка', place: 'Bulwary Wiślane' },
]

/* ---------- Lviv: for testing with friends in Ukraine ---------- */

const AREAS_LVIV = [
  'Центр',
  'Франківський',
  'Личаківський',
  'Сихівський',
  'Шевченківський',
  'Залізничний',
  'Весь Львів',
]

const VENUES_LVIV: Record<string, string[]> = {
  Кава: ['Площа Ринок', 'Проспект Свободи'],
  'Бар/Ресторан': ['Площа Ринок', 'вул. Вірменська', 'Проспект Свободи'],
  Прогулянка: ['Стрийський парк', 'Високий замок'],
  Кіно: ['Forum Lviv', 'Victoria Gardens'],
  Спорт: ['Стрийський парк', 'Парк Знесіння'],
  Ігри: ['Центр', 'біля Політехніки'],
  Культура: ['Національний музей', 'Оперний театр'],
}

const lvivPlace: Record<string, string> = {
  'person-1': 'Центр, Франківський',
  'person-2': 'Весь Львів',
  'person-3': 'Франківський',
}

const PEOPLE_LVIV: FeedCard[] = PEOPLE_WARSAW.map((c) => ({
  ...c,
  place: lvivPlace[c.id] ?? c.place,
  headline: c.headline.replace('Нова у Варшаві', 'Нова у Львові'),
}))

const EVENTS_LVIV: FeedCard[] = [
  {
    ...EVENTS_WARSAW[0],
    headline: 'Граємо в більярд о 20:00 у центрі. Нас двоє, шукаємо ще двох',
    place: 'Центр',
    venue: 'Центр',
  },
  {
    ...EVENTS_WARSAW[1],
    headline: 'Настолки біля Політехніки: Codenames і Каркасон. Пояснимо правила',
    place: 'Центр',
    venue: 'вул. Степана Бандери',
  },
  {
    ...EVENTS_WARSAW[2],
    headline: 'Легка пробіжка 5 км у Стрийському парку, темп 6:00. Новачкам раді',
    place: 'Франківський',
    venue: 'Стрийський парк',
  },
]

const INVITERS_LVIV = [
  { name: 'Софія', age: 25, tag: 'Кава', place: 'Проспект Свободи' },
  { name: 'Максим', age: 28, tag: 'Бар/Ресторан', place: 'Площа Ринок' },
  { name: 'Ліза', age: 30, tag: 'Прогулянка', place: 'Стрийський парк' },
]

const lviv = CITY === 'lviv'
export const AREAS = lviv ? AREAS_LVIV : AREAS_WARSAW
export const VENUES = lviv ? VENUES_LVIV : VENUES_WARSAW
export const PEOPLE = lviv ? PEOPLE_LVIV : PEOPLE_WARSAW
// Demo plans look for exactly one more person each: the button always says «ще 1 місце».
export const EVENTS = (lviv ? EVENTS_LVIV : EVENTS_WARSAW).map((e) => ({ ...e, capacity: (e.taken ?? 1) + 1 }))
export const INVITERS = lviv ? INVITERS_LVIV : INVITERS_WARSAW

/** "Whole city" option: always the last area in the list. */
export const WHOLE_CITY = AREAS[AREAS.length - 1]
export const MAX_AREAS = 3

/** How a list of districts is shown on a card: "Центр, Франківський +1". */
export function formatAreas(list: string[]): string {
  if (list.length <= 2) return list.join(', ')
  return `${list[0]}, ${list[1]} +${list.length - 2}`
}
