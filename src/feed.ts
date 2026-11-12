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
  /** Free-time post: roughly where the person is (≈500 m), shown only as a label + distance */
  near?: { lat: number; lon: number; label: string; exact?: boolean }
  /** Free-time post: how far the person is ready to go, km */
  reach?: number
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

const lvivNear: Record<string, { near: NonNullable<FeedCard['near']>; reach: number }> = {
  'person-1': { near: { lat: 49.8415, lon: 24.032, label: 'біля Ринку' }, reach: 5 },
  'person-2': { near: { lat: 49.84395, lon: 24.02625, label: 'Оперний театр', exact: true }, reach: 10 },
  'person-3': { near: { lat: 49.8235, lon: 24.0235, label: 'біля Стрийського парку' }, reach: 2 },
}

const PEOPLE_LVIV: FeedCard[] = PEOPLE_WARSAW.map((c) => ({
  ...c,
  ...lvivNear[c.id],
  place: lvivNear[c.id]?.near.label ?? lvivPlace[c.id] ?? c.place,
  headline: c.headline.replace('Нова у Варшаві', 'Нова у Львові'),
}))

const EVENTS_LVIV: FeedCard[] = [
  {
    ...EVENTS_WARSAW[0],
    headline: 'Граємо в більярд о 20:00 у центрі. Нас двоє, шукаємо ще двох',
    place: 'Центр',
    areas: ['Центр'],
    venue: 'Більярдний клуб на Городоцькій',
    venueAddress: 'вулиця Городоцька, 25',
    lat: 49.8399,
    lon: 24.0175,
  },
  {
    ...EVENTS_WARSAW[1],
    headline: 'Настолки біля Політехніки: Codenames і Каркасон. Пояснимо правила',
    place: 'Центр',
    areas: ['Центр'],
    venue: 'Кав’ярня біля Політехніки',
    venueAddress: 'вулиця Степана Бандери, 12',
    lat: 49.8357,
    lon: 24.0144,
  },
  {
    ...EVENTS_WARSAW[2],
    headline: 'Легка пробіжка 5 км у Стрийському парку, темп 6:00. Новачкам раді',
    place: 'Франківський',
    areas: ['Франківський'],
    venue: 'Стрийський парк',
    venueAddress: 'вхід з вулиці Стрийської',
    lat: 49.8236,
    lon: 24.0236,
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

/* ---------- Харків: demo cards so the feed isn't empty there ---------- */

export const KHARKIV_EVENTS: FeedCard[] = [
  {
    id: 'kh-event-1',
    kind: 'event',
    headline: 'Мафія і Codenames у кав’ярні на Сумській. Нас троє, шукаємо ще трьох',
    bio: 'Аналітик, збираю ігрові вечори щочетверга.',
    time: '19:30',
    place: 'Центр',
    areas: ['Центр'],
    venue: 'Кав’ярня на Сумській',
    venueAddress: 'вулиця Сумська, 25',
    lat: 50.0011,
    lon: 36.2349,
    tags: ['Ігри'],
    name: 'Артем',
    age: 29,
    gender: 'Чоловік',
    taken: 3,
    capacity: 6,
  },
  {
    id: 'kh-event-2',
    kind: 'event',
    headline: 'Вечірня прогулянка парком Горького, потім какао в кіоску біля входу',
    bio: 'Маркетологиня, гуляю щовечора після роботи.',
    time: '18:30',
    place: 'Центр',
    areas: ['Центр'],
    venue: 'Парк Горького',
    venueAddress: 'головний вхід з вулиці Сумської',
    lat: 50.0098,
    lon: 36.2355,
    tags: ['Прогулянка'],
    name: 'Аліна',
    age: 27,
    gender: 'Жінка',
    taken: 1,
    capacity: 4,
  },
  {
    id: 'kh-event-3',
    kind: 'event',
    headline: 'Біжимо 5 км у Саржиному Яру, темп спокійний. Новачкам раді',
    bio: 'Бігаю два роки, готуюсь до першого напівмарафону.',
    time: '19:00',
    place: 'Шевченківський',
    areas: ['Шевченківський'],
    venue: 'Саржин Яр',
    venueAddress: 'вхід з вулиці Клочківської',
    lat: 50.0216,
    lon: 36.2196,
    tags: ['Спорт'],
    name: 'Денис',
    age: 32,
    gender: 'Чоловік',
    taken: 2,
    capacity: 5,
  },
  {
    id: 'kh-event-4',
    kind: 'event',
    headline: 'Пиво і паб-квіз біля Держпрому. Команда з чотирьох, бракує одного',
    bio: 'Розробниця, любимо квізи і погані жарти.',
    time: '20:00',
    place: 'Центр',
    areas: ['Центр'],
    venue: 'Паб біля Держпрому',
    venueAddress: 'майдан Свободи, 7',
    lat: 50.0063,
    lon: 36.2292,
    tags: ['Бар/Ресторан'],
    name: 'Катерина',
    age: 28,
    gender: 'Жінка',
    taken: 4,
    capacity: 5,
  },
]

export const KHARKIV_PEOPLE: FeedCard[] = [
  {
    id: 'kh-person-1',
    kind: 'person',
    headline: 'Вільна після 18. Хочу на каву і просто поговорити про книжки',
    bio: 'Ілюстраторка, люблю старі фільми і книгарні.',
    time: '18:00 - 21:00',
    place: 'біля Держпрому',
    near: { lat: 50.006, lon: 36.228, label: 'біля Держпрому' },
    reach: 5,
    tags: ['Кава', 'Прогулянка'],
    name: 'Даря',
    age: 26,
    gender: 'Жінка',
  },
  {
    id: 'kh-person-2',
    kind: 'person',
    headline: 'Хто на більярд або боулінг сьогодні ввечері?',
    bio: 'Розробник, граю в більярд по п’ятницях.',
    time: '19:00 - 23:00',
    place: 'Олексіївка',
    near: { lat: 50.051, lon: 36.204, label: 'Олексіївка' },
    reach: 10,
    tags: ['Ігри', 'Бар/Ресторан'],
    name: 'Ігор',
    age: 30,
    gender: 'Чоловік',
  },
  {
    id: 'kh-person-3',
    kind: 'person',
    headline: 'Нова в Харкові. Шукаю компанію на прогулянку центром',
    bio: 'Переїхала з Києва, люблю фотографувати місто.',
    time: '17:30 - 20:30',
    place: 'Сад Шевченка',
    near: { lat: 50.0055, lon: 36.2335, label: 'Сад Шевченка', exact: true },
    reach: 2,
    tags: ['Прогулянка', 'Кава'],
    name: 'Марина',
    age: 24,
    gender: 'Жінка',
  },
]

export const KHARKIV_VENUES: Record<string, string[]> = {
  Кава: ['Сумська', 'Сад Шевченка', 'Пушкінська'],
  'Бар/Ресторан': ['майдан Свободи', 'Пушкінська', 'Сумська'],
  Прогулянка: ['Парк Горького', 'Сад Шевченка', 'Саржин Яр'],
  Кіно: ['ТРЦ Французький бульвар', 'Сумська'],
  Спорт: ['Саржин Яр', 'Парк Горького'],
  Ігри: ['Сумська', 'Пушкінська'],
  Культура: ['Держпром', 'Сад Шевченка'],
}
