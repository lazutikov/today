/**
 * Guesses gender from a Telegram first name, only to pre-fill onboarding.
 * The person sees the choice and can change it; unknown or ambiguous names
 * return null and the card says «Стать не вказана».
 */

const FEMALE = new Set(
  `олена олена оля ольга оксана ірина ирина марта марія мария анна ганна аня яна юлія юля катерина катя
  наталія наталя наташа тетяна таня світлана света людмила люда вікторія вика віка христина софія софия соня
  дарина даша дар'я дарья анастасія настя ксенія ксюша аліна алина вероніка лілія ліля надія надя віра любов
  галина галя лариса мирослава богдана зоряна соломія уляна ульяна злата діана диана поліна полина маргарита
  ангеліна єва ева елизавета єлизавета ліза лиза мілана милана кіра кира алла інна инна жанна мар'яна марьяна
  emma anna olena olha olga olia olya oksana iryna irina marta maria mariia yana yulia julia kateryna kate
  natalia tetiana tania svitlana sveta viktoria victoria khrystyna sofia sophia daryna dasha anastasia nastia
  nastya ksenia alina veronika lilia nadia vira halyna larysa solomiia uliana zlata diana polina margarita
  angelina eva liza milana kira alla inna zhanna kasia katarzyna agnieszka magda magdalena ola aleksandra
  joanna monika ewa zuzanna sarah laura lisa emily kate kateryna ira mila lena liana`.split(/\s+/),
)

const MALE = new Set(
  `тарас андрій андрей олег максим дмитро дмитрий дима іван иван петро петр павло павел юрій юрий богдан
  ярослав остап назар роман михайло михаил сергій сергей олександр александр володимир владимир віталій
  виталий василь василий степан ігор игорь артем артём денис антон євген евгений віктор виктор вадим костянтин
  константин микола николай ілля илья нікіта никита лука данило даниил кирило кирилл матвій мирослав святослав
  захар тимур тимофій руслан станіслав станислав валентин валерій едуард эдуард геннадій леонід олексій алексей
  taras andrii andriy andrew andrey oleh oleg maksym max maxim dmytro dmitry dima ivan petro pavlo paul yurii
  bohdan yaroslav ostap nazar roman mykhailo michael serhii sergey oleksandr alexander alex volodymyr vladimir
  vitalii vasyl stepan ihor igor artem denys denis anton yevhen eugene viktor victor vadym kostiantyn mykola
  illia ilya nikita nick nik luka danylo daniel kyrylo matvii sviatoslav zakhar timur ruslan stanislav valentyn
  eduard oleksii alexey john james david tom tomasz piotr pawel paweł jakub kuba michał michal krzysztof marek
  marcin bartek bartosz adam jan kamil lukasz łukasz mateusz wojciech grzegorz rafal rafał`.split(/\s+/),
)

/** Short forms that are used for both (Саша, Женя, Валя...) */
const EITHER = new Set('саша женя валя слава шура sasha zhenia zhenya valia slava'.split(' '))

export function guessGender(firstName: string | null | undefined): 'Чоловік' | 'Жінка' | null {
  if (!firstName) return null
  const name = firstName
    .trim()
    .split(/[\s_.-]+/)[0]
    .toLowerCase()
    .replace(/[’`ʼ]/g, "'")
  if (!name || EITHER.has(name)) return null
  if (FEMALE.has(name)) return 'Жінка'
  if (MALE.has(name)) return 'Чоловік'
  // Ukrainian / Russian names ending in -а/-я are mostly female, but only when written in Cyrillic.
  if (/^[\p{Script=Cyrillic}']+[ая]$/u.test(name) && name.length > 2) return 'Жінка'
  return null
}
