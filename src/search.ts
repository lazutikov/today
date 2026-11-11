/**
 * Feed search: every word must be found somewhere on the card (plan text,
 * venue, address, district, «про себе», category). Matching is by beginning
 * of words, so «кав» finds «кава» and «кав’ярня», «сих» finds «Сихівський».
 */
import { detectTags } from './autotags'
import type { FeedCard } from './feed'

const norm = (s: string) => s.toLowerCase().replace(/[’'ʼ`]/g, "'").replace(/ё/g, 'е')

function haystack(c: FeedCard): string {
  return norm(
    [c.headline, c.bio, c.venue, c.venueAddress, c.place, ...(c.areas ?? []), ...c.tags, c.gender, c.age ? String(c.age) : '']
      .filter(Boolean)
      .join(' '),
  )
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function wordsOf(query: string) {
  return norm(query).split(/\s+/).filter((w) => w.length > 0)
}

/** Every word starts a word somewhere on the card */
function literal(card: FeedCard, words: string[]) {
  const text = haystack(card)
  return words.every((w) => new RegExp(`(^|[^\\p{L}])${escape(w)}`, 'u').test(text))
}

/** …or, for a word that isn't written there, the category it implies («пиво» → Бар/Ресторан) */
function byCategory(card: FeedCard, words: string[]) {
  const text = haystack(card)
  return words.every((w) => {
    if (new RegExp(`(^|[^\\p{L}])${escape(w)}`, 'u').test(text)) return true
    const tags = detectTags(w)
    return tags.length > 0 && tags.some((t) => card.tags.includes(t))
  })
}

/** Exact words first; the category fallback only when the words themselves find nothing */
export function filterByQuery(cards: FeedCard[], query: string): FeedCard[] {
  const words = wordsOf(query)
  if (words.length === 0) return cards
  const exact = cards.filter((c) => literal(c, words))
  return exact.length > 0 ? exact : cards.filter((c) => byCategory(c, words))
}
