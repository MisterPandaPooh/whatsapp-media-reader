// src/components/Toolbar/occasions.ts
//
// The occasion list behind the DATE popover's quick pickers: what they are
// called, and which days each one covers.
//
// The list ships with a default, and can be replaced wholesale from
// localStorage so a different family, calendar or language needs no rebuild:
//
//   localStorage.setItem('wmr.data.occasions', JSON.stringify({ … }))
//
// A holiday is given as explicit dates because Passover, Sukkot and Hanukkah
// follow the Hebrew calendar — deriving them would mean shipping a whole
// calendar conversion for a handful of fixed years, where a table is smaller,
// exact and auditable. A season is given as a recurring month-day window, since
// "June to August" is the same every year.

export interface OccasionDates {
  year: number
  /** YYYY-MM-DD, inclusive. */
  start: string
  /** YYYY-MM-DD, inclusive. May fall in the following year (Hanukkah does). */
  end: string
}

/** A window that repeats every year, as MM-DD. A day past the end of the month
 *  is clamped, so `02-29` is leap-safe and means "end of February". */
export interface OccasionSeason {
  from: string
  to: string
}

export interface Occasion {
  id: string
  label: string
  /** Exactly one of these. `dates` also contributes to the year list. */
  dates?: OccasionDates[]
  season?: OccasionSeason
}

export interface OccasionsConfig {
  occasions: Occasion[]
  /**
   * Days of slack either side of a dated occasion. The photos people want are
   * rarely confined to the festival itself — travelling out, the cooking the day
   * before, the drive home after — so the table's exact dates are a poor edge
   * for a media filter. Not applied to a season, which is already an approximate
   * window; padding June would just bleed into May.
   */
  padDays: number
  /** Selectable years. Derived from `dates` when absent. */
  years?: number[]
}

export const OCCASIONS_STORAGE_KEY = 'wmr.data.occasions'

export const DEFAULT_OCCASIONS: OccasionsConfig = {
  padDays: 3,
  occasions: [
    {
      id: 'passover',
      label: 'Passover',
      dates: [
        { year: 2020, start: '2020-04-08', end: '2020-04-15' },
        { year: 2021, start: '2021-03-27', end: '2021-04-03' },
        { year: 2022, start: '2022-04-15', end: '2022-04-22' },
        { year: 2023, start: '2023-04-05', end: '2023-04-12' },
        { year: 2024, start: '2024-04-22', end: '2024-04-29' },
        { year: 2025, start: '2025-04-12', end: '2025-04-19' },
        { year: 2026, start: '2026-04-01', end: '2026-04-08' },
      ],
    },
    {
      id: 'sukkot',
      label: 'Sukkot',
      dates: [
        { year: 2020, start: '2020-10-02', end: '2020-10-09' },
        { year: 2021, start: '2021-09-20', end: '2021-09-27' },
        { year: 2022, start: '2022-10-09', end: '2022-10-16' },
        { year: 2023, start: '2023-09-29', end: '2023-10-06' },
        { year: 2024, start: '2024-10-16', end: '2024-10-23' },
        { year: 2025, start: '2025-10-06', end: '2025-10-13' },
        { year: 2026, start: '2026-09-25', end: '2026-10-02' },
      ],
    },
    {
      id: 'hanukkah',
      label: 'Hanukkah',
      dates: [
        { year: 2020, start: '2020-12-10', end: '2020-12-18' },
        { year: 2021, start: '2021-11-28', end: '2021-12-06' },
        { year: 2022, start: '2022-12-18', end: '2022-12-26' },
        { year: 2023, start: '2023-12-07', end: '2023-12-15' },
        // Straddles the new year; the span is built from both dates, so the
        // December label and the January days land in the same selection.
        { year: 2024, start: '2024-12-25', end: '2025-01-02' },
        { year: 2025, start: '2025-12-14', end: '2025-12-22' },
        { year: 2026, start: '2026-12-04', end: '2026-12-12' },
      ],
    },
    { id: 'summer', label: 'Summer', season: { from: '06-01', to: '08-31' } },
    // 02-29 is clamped to the last day of February, leap year or not.
    { id: 'winter', label: 'Winter', season: { from: '01-01', to: '02-29' } },
  ],
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_DAY = /^\d{2}-\d{2}$/

/**
 * Validates an override. A hand-written JSON blob in localStorage is the least
 * trustworthy input in the app, and a malformed one must not take the date
 * filter — or the whole toolbar — down with it, so anything that does not fit
 * the shape is rejected outright in favour of the default.
 */
export function parseOccasions(raw: string): OccasionsConfig | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const cfg = value as Partial<OccasionsConfig>
  if (!Array.isArray(cfg.occasions) || cfg.occasions.length === 0) return null

  const occasions: Occasion[] = []
  for (const o of cfg.occasions) {
    if (!o || typeof o.id !== 'string' || !o.id || typeof o.label !== 'string') return null
    if (o.season) {
      if (!MONTH_DAY.test(o.season.from) || !MONTH_DAY.test(o.season.to)) return null
      occasions.push({ id: o.id, label: o.label, season: o.season })
      continue
    }
    if (!Array.isArray(o.dates) || o.dates.length === 0) return null
    for (const d of o.dates) {
      if (!d || !Number.isInteger(d.year)) return null
      if (!ISO_DATE.test(d.start) || !ISO_DATE.test(d.end)) return null
    }
    occasions.push({ id: o.id, label: o.label, dates: o.dates })
  }

  const padDays = Number.isInteger(cfg.padDays) && cfg.padDays! >= 0 ? cfg.padDays! : DEFAULT_OCCASIONS.padDays
  const years =
    Array.isArray(cfg.years) && cfg.years.every((y) => Number.isInteger(y)) ? cfg.years : undefined
  return { occasions, padDays, years }
}

/**
 * The occasion list in force. Read fresh on each call rather than cached at
 * module load: the key is edited from the console, and a cache would mean the
 * override only appeared after a hard reload with no way to tell why.
 */
export function loadOccasions(): OccasionsConfig {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(OCCASIONS_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, blocked cookies) — use the default.
    return DEFAULT_OCCASIONS
  }
  if (!raw) return DEFAULT_OCCASIONS
  const parsed = parseOccasions(raw)
  if (!parsed) {
    console.warn(
      `[occasions] Ignoring ${OCCASIONS_STORAGE_KEY}: not a valid occasions config. Using the built-in list.`,
    )
    return DEFAULT_OCCASIONS
  }
  return parsed
}
