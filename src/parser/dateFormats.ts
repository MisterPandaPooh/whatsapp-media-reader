export interface DateMatch {
  timestampMs: number
  rest: string
}

// 2-digit years are pivoted at 50: '00'-'50' -> 2000-2050, '51'-'99' -> 1951-1999.
// WhatsApp exports never predate 2009, so this range comfortably covers real
// chat history without ambiguity in either direction.
function normalizeYear(y: number): number {
  return y < 100 ? y + (y > 50 ? 1900 : 2000) : y
}

function buildDate(
  day: number, month: number, year: number,
  hours: number, minutes: number, seconds: number, ampm?: string,
): number {
  let h = hours
  if (ampm) {
    const isPM = ampm.toUpperCase() === 'PM'
    if (isPM && hours !== 12) h = hours + 12
    else if (!isPM && hours === 12) h = 0
  }
  return new Date(year, month - 1, day, h, minutes, seconds).getTime()
}

interface Pattern {
  regex: RegExp
  parse: (m: RegExpMatchArray) => number
}

// --- Shared time-suffix fragments -----------------------------------------
// The slash-delimited date formats (US, EU/BR, Asian) are textually
// ambiguous between MM/DD and DD/MM ordering: '3/9/25' could be March 9th or
// September 3rd. WhatsApp's own export convention is what disambiguates it:
// the US locale export always includes an AM/PM marker ('8:14 AM'), while
// EU/BR/Asian 24h exports never do. So "does this line have an AM/PM
// suffix?" is used as the signal for which day/month order to assume,
// rather than trying to inspect the numeric values themselves.
const TIME_24H = String.raw`,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*`
const TIME_12H = String.raw`,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*-\s*`

// iOS-bracketed exports always include seconds and never use the ' - '
// separator (they close with ']' instead). Whitespace before AM/PM may be a
// regular space or the Unicode narrow no-break space (U+202F) iOS sometimes
// inserts; JS's `\s` already matches U+202F (it's in the Zs category), so a
// plain `\s*` covers both.
const IOS_TIME_24H = String.raw`,?\s+(\d{1,2}):(\d{2}):(\d{2})\]\s*`
const IOS_TIME_12H = String.raw`,?\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\]\s*`

// --- Locale-specific date prefixes (legitimately distinct per format) ----
const SLASH_DATE = String.raw`(\d{1,2})/(\d{1,2})/(\d{2,4})` // US or EU/BR, order disambiguated by AM/PM presence
const SLASH_DATE_YMD = String.raw`(\d{4})/(\d{1,2})/(\d{1,2})` // Asian: year/month/day
const ISO_DATE = String.raw`(\d{4})-(\d{1,2})-(\d{1,2})`
const DOT_DATE = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2,4})` // German: day.month.year
const DASH_DATE = String.raw`(\d{1,2})-(\d{1,2})-(\d{2,4})` // day-month-year
const IOS_DATE = String.raw`\[(\d{1,2})/(\d{1,2})/(\d{2,4})`

const PATTERNS: Pattern[] = [
  // MM/DD/YY, H:MM(:SS)? AM/PM - US
  {
    regex: new RegExp(`^${SLASH_DATE}${TIME_12H}`, 'i'),
    parse: (m) => buildDate(+m[2], +m[1], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // DD/MM/YY, H:MM(:SS)? - EU/BR 24h (no AM/PM)
  {
    regex: new RegExp(`^${SLASH_DATE}${TIME_24H}`),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY-MM-DD, H:MM(:SS)? - ISO
  {
    regex: new RegExp(`^${ISO_DATE}${TIME_24H}`),
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD.MM.YY, H:MM(:SS)? - German dot format
  {
    regex: new RegExp(`^${DOT_DATE}${TIME_24H}`),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD-MM-YY, H:MM(:SS)? - dash format
  {
    regex: new RegExp(`^${DASH_DATE}${TIME_24H}`),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY/MM/DD, H:MM(:SS)? AM/PM - Asian 12h
  {
    regex: new RegExp(`^${SLASH_DATE_YMD}${TIME_12H}`, 'i'),
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // YYYY/MM/DD, H:MM(:SS)? - Asian 24h
  {
    regex: new RegExp(`^${SLASH_DATE_YMD}${TIME_24H}`),
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // [DD/MM/YY, H:MM:SS AM/PM] - iOS bracketed 12h
  {
    regex: new RegExp(`^${IOS_DATE}${IOS_TIME_12H}`, 'i'),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6], m[7]),
  },
  // [DD/MM/YY, H:MM:SS] - iOS bracketed 24h
  {
    regex: new RegExp(`^${IOS_DATE}${IOS_TIME_24H}`),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6]),
  },
]

/**
 * Bidi control characters. iOS writes a LEFT-TO-RIGHT MARK at the start of
 * every exported line — invisible, and *not* whitespace (it is category Cf, so
 * neither `\s` nor `String#trim` touches it). Every pattern below anchors with
 * `^` directly on the date, so an unstripped mark makes the line fail to match:
 * it is then treated as a continuation and the whole "[date] Sender: …" prefix
 * shows up as raw text inside the previous bubble.
 */
const LEADING_BIDI = /^[‎‏‪-‮⁦-⁩]+/

export function matchDatePrefix(line: string): DateMatch | null {
  // Match against the stripped line, and slice from it too, so `rest` never
  // carries the mark forward into the sender/content split.
  const text = line.replace(LEADING_BIDI, '')
  for (const { regex, parse } of PATTERNS) {
    const m = text.match(regex)
    if (m) {
      return { timestampMs: parse(m), rest: text.slice(m[0].length) }
    }
  }
  return null
}
