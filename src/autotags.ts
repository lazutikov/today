/**
 * Detects categories from free text ("Хочу на каву або в кіно" → Кава, Кіно).
 * Word stems in Ukrainian, plus common Russian, Polish and English words.
 * A stem must start a word, so "бар" does not fire on "Барселона".
 */

const STEMS: Record<string, string[]> = {
  Кава: ['кав', 'кофе', 'кофі', 'coffee', 'kaw', 'американо', 'лате', 'капучин', 'еспресо', 'флет', 'чай', 'десерт'],
  'Бар/Ресторан': [
    'бар(?!сел|бер)', 'пив', 'beer', 'piw', 'крафт', 'вин[оаі]', 'келих', 'бокал', 'коктейл', 'drink', 'дрінк',
    'джин', 'віскі', 'ресторан', 'вечер[яюі]', 'поїст', 'поесть', 'їж[аиу]', 'обід', 'піц', 'пицц', 'суш',
    'бургер', 'рамен', 'шаурм', 'food', 'dinner', 'lunch', 'паб',
  ],
  Прогулянка: ['прогул', 'пройт', 'погуля', 'гуля', 'пройд', 'walk', 'spacer', 'парк', 'набережн'],
  Кіно: ['кіно', 'кино', 'фільм', 'фильм', 'film', 'cinema', 'movie', 'сеанс', 'театр', 'вистав(?!к)'],
  Спорт: [
    'спорт', 'біг', 'пробіж', 'бега', 'run', 'йог', 'грати у футбол', 'теніс', 'тенис', 'падел',
    'padel', 'зал(?!\\p{L})', 'gym', 'вело', 'скелел', 'плава', 'басейн', 'баскетбол', 'волейбол',
  ],
  Ігри: ['більярд', 'бильярд', 'пул\\b', 'снукер', 'pool', 'bilard', 'настол', 'настіл', 'board', 'codenames', 'мафі', 'монопол', 'каркасон', 'катан', 'боулін', 'боулин', 'bowling', 'kręgl', 'квіз', 'quiz', 'ігр', 'игр'],
  Культура: ['виставк', 'выставк', 'музе', 'галере', 'концерт', 'лекці', 'опер[аиуі]', 'джаз', 'стендап', 'exhibition', 'museum', 'concert'],
}

const MATCHERS = Object.entries(STEMS).map(
  ([tag, stems]) => [tag, new RegExp(`(?<!\\p{L})(${stems.join('|')})`, 'iu')] as const,
)

/** Categories found in the text, in the order of the fixed list. */
export function detectTags(text: string): string[] {
  return MATCHERS.filter(([, re]) => re.test(text)).map(([tag]) => tag)
}
