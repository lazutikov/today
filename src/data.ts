export type Activity = {
  id: string
  label: string
  icon: string
}

export const ACTIVITIES: Activity[] = [
  { id: 'coffee', label: 'Кава', icon: '☕' },
  { id: 'bar', label: 'Бар', icon: '🍺' },
  { id: 'food', label: 'Їжа', icon: '🍜' },
  { id: 'walk', label: 'Прогулянка', icon: '🚶' },
  { id: 'cinema', label: 'Кіно', icon: '🎬' },
  { id: 'sport', label: 'Спорт', icon: '🏃' },
  { id: 'pool', label: 'Більярд', icon: '🎱' },
  { id: 'boardgames', label: 'Настолки', icon: '🎲' },
]

export const DISTRICTS = [
  'Śródmieście',
  'Mokotów',
  'Wola',
  'Praga-Północ',
  'Ochota',
  'Żoliborz',
  'Praga-Południe',
  'Ursynów',
  'Cała Warszawa',
]

export const activity = (id: string) => ACTIVITIES.find((a) => a.id === id)!

/** A host's concrete plan: "I'm going to X at Y, who's in?" */
export type PlanCard = {
  kind: 'plan'
  id: string
  activity: string
  place: string
  district: string
  time: string
  startsIn: string
  taken: number
  capacity: number
  note?: string
}

/** A free time window: "I'm free 18–21, up for X, Y, Z" — others send invites. */
export type WindowCard = {
  kind: 'window'
  id: string
  from: string
  to: string
  district: string
  activities: string[]
  note?: string
}

export type Card = PlanCard | WindowCard

/**
 * Demo feed. These are illustrative examples, not real people:
 * the UI always labels them as "приклад".
 */
export const DEMO_FEED: Card[] = [
  {
    kind: 'plan',
    id: 'p-pool',
    activity: 'pool',
    place: 'Klub bilardowy, Nowy Świat',
    district: 'Śródmieście',
    time: '20:00',
    startsIn: 'через 47 хв',
    taken: 2,
    capacity: 4,
    note: 'Граємо в пул, рівень — аматорський',
  },
  {
    kind: 'window',
    id: 'w-1',
    from: '18:00',
    to: '21:00',
    district: 'Mokotów',
    activities: ['coffee', 'cinema', 'walk'],
  },
  {
    kind: 'plan',
    id: 'p-board',
    activity: 'boardgames',
    place: 'Plac Politechniki',
    district: 'Śródmieście',
    time: '19:30',
    startsIn: 'через 1 год 15 хв',
    taken: 3,
    capacity: 5,
    note: 'Шукаємо ще двох на Кодові імена',
  },
  {
    kind: 'window',
    id: 'w-2',
    from: '19:00',
    to: '22:00',
    district: 'Wola',
    activities: ['bar', 'pool', 'boardgames'],
    note: 'Можна компанією',
  },
  {
    kind: 'plan',
    id: 'p-run',
    activity: 'sport',
    place: 'Pole Mokotowskie, вхід з Żwirki i Wigury',
    district: 'Ochota',
    time: '19:00',
    startsIn: 'через 44 хв',
    taken: 1,
    capacity: 4,
    note: 'Легкі 5 км, темп 6:00',
  },
  {
    kind: 'window',
    id: 'w-3',
    from: '18:30',
    to: '20:30',
    district: 'Praga-Północ',
    activities: ['food', 'coffee'],
  },
  {
    kind: 'plan',
    id: 'p-walk',
    activity: 'walk',
    place: 'Bulwary Wiślane, біля Centrum Nauki Kopernik',
    district: 'Powiśle',
    time: '20:30',
    startsIn: 'через 2 год',
    taken: 2,
    capacity: 5,
  },
  {
    kind: 'window',
    id: 'w-4',
    from: '20:00',
    to: '23:00',
    district: 'Śródmieście',
    activities: ['bar', 'cinema'],
  },
]
