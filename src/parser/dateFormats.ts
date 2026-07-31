export interface DateMatch {
  timestampMs: number
  rest: string
}

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

// Whitespace that may appear between the seconds and AM/PM (and after AM/PM
// before the closing bracket) in iOS exports: a regular space or the Unicode
// narrow no-break space (U+202F) that iOS sometimes inserts.
const IOS_SPACE = '[\\s ]*'

const PATTERNS: Pattern[] = [
  // MM/DD/YY, H:MM(:SS)? AM/PM - US
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*-\s*/i,
    parse: (m) => buildDate(+m[2], +m[1], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // DD/MM/YY, H:MM(:SS)? - EU/BR 24h (no AM/PM)
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY-MM-DD, H:MM(:SS)? - ISO
  {
    regex: /^(\d{4})-(\d{1,2})-(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD.MM.YY, H:MM(:SS)? - German dot format
  {
    regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD-MM-YY, H:MM(:SS)? - dash format
  {
    regex: /^(\d{1,2})-(\d{1,2})-(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY/MM/DD, H:MM(:SS)? AM/PM - Asian 12h
  {
    regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*-\s*/i,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // YYYY/MM/DD, H:MM(:SS)? - Asian 24h
  {
    regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // [DD/MM/YY, H:MM:SS AM/PM] - iOS bracketed 12h (space before AM/PM may be
  // a regular space or a Unicode narrow no-break space, U+202F)
  {
    regex: new RegExp(
      `^\\[(\\d{1,2})/(\\d{1,2})/(\\d{2,4}),?\\s+(\\d{1,2}):(\\d{2}):(\\d{2})${IOS_SPACE}([AP]M)\\]\\s*`,
      'i',
    ),
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6], m[7]),
  },
  // [DD/MM/YY, H:MM:SS] - iOS bracketed 24h
  {
    regex: /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\]\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6]),
  },
]

export function matchDatePrefix(line: string): DateMatch | null {
  for (const { regex, parse } of PATTERNS) {
    const m = line.match(regex)
    if (m) {
      return { timestampMs: parse(m), rest: line.slice(m[0].length) }
    }
  }
  return null
}
