/**
 * Feed order without filters: nothing is hidden, the relevant comes first.
 * Own posts → real people → still ahead today → my districts (then whole
 * city, then the rest) → soonest first. Past plans sink to the bottom.
 */
import { WHOLE_CITY, type FeedCard } from './feed'
import { distanceKm, type Coords } from './location'

const toMin = (t: string) => {
  const m = /(\d{1,2}):(\d{2})/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function cardAreas(c: FeedCard): string[] {
  if (c.areas?.length) return c.areas
  return c.place
    .split(',')
    .map((s) => s.replace(/\+\d+/, '').trim())
    .filter(Boolean)
}

export function rankFeed(
  cards: FeedCard[],
  myAreas: string[] = [],
  now = new Date(),
  here?: Coords | null,
): FeedCard[] {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const everywhere = myAreas.length === 0 || myAreas.includes(WHOLE_CITY)

  const key = (c: FeedCard) => {
    const [from, to] = c.time.split('-').map((x) => toMin(x))
    const end = to ?? from ?? 24 * 60
    const areas = cardAreas(c)
    // Known position + a real venue: closeness beats district names
    const km = here && c.lat !== undefined && c.lon !== undefined ? distanceKm(here, { lat: c.lat, lon: c.lon }) : null
    const areaRank =
      km !== null
        ? km < 2.5
          ? 0
          : km < 6
            ? 1
            : 2
        : everywhere || areas.some((a) => myAreas.includes(a))
          ? 0
          : areas.includes(WHOLE_CITY)
            ? 1
            : 2
    return [c.mine ? 0 : 1, c.real ? 0 : 1, end <= nowMin ? 1 : 0, areaRank, from ?? 24 * 60]
  }

  return cards
    .map((c, i) => ({ c, k: key(c), i }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j]
      return a.i - b.i
    })
    .map((x) => x.c)
}
