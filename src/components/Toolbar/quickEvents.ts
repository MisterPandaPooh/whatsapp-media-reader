import { addDays, endOfDay, startOfDay } from './dateRange'
import type { DateSpan } from '../../store/useChatStore'

/**
 * Recurring moments worth jumping to in a family/group chat, as concrete date
 * spans rather than a rule.
 *
 * The holiday dates are hardcoded on purpose: they follow the Hebrew calendar,
 * so deriving them would mean shipping a whole calendar conversion for seven
 * fixed years. A table is smaller, exact, and obviously auditable — the cost is
 * that it needs extending past 2026.
 */
interface HolidayYear {
  year: number
  start: string // YYYY-MM-DD, inclusive
  end: string // YYYY-MM-DD, inclusive
}

const HOLIDAYS: Record<string, HolidayYear[]> = {
  pessah: [
    { year: 2020, start: '2020-04-08', end: '2020-04-15' },
    { year: 2021, start: '2021-03-27', end: '2021-04-03' },
    { year: 2022, start: '2022-04-15', end: '2022-04-22' },
    { year: 2023, start: '2023-04-05', end: '2023-04-12' },
    { year: 2024, start: '2024-04-22', end: '2024-04-29' },
    { year: 2025, start: '2025-04-12', end: '2025-04-19' },
    { year: 2026, start: '2026-04-01', end: '2026-04-08' },
  ],
  souccot: [
    { year: 2020, start: '2020-10-02', end: '2020-10-09' },
    { year: 2021, start: '2021-09-20', end: '2021-09-27' },
    { year: 2022, start: '2022-10-09', end: '2022-10-16' },
    { year: 2023, start: '2023-09-29', end: '2023-10-06' },
    { year: 2024, start: '2024-10-16', end: '2024-10-23' },
    { year: 2025, start: '2025-10-06', end: '2025-10-13' },
    { year: 2026, start: '2026-09-25', end: '2026-10-02' },
  ],
  hanouka: [
    { year: 2020, start: '2020-12-10', end: '2020-12-18' },
    { year: 2021, start: '2021-11-28', end: '2021-12-06' },
    { year: 2022, start: '2022-12-18', end: '2022-12-26' },
    { year: 2023, start: '2023-12-07', end: '2023-12-15' },
    // Straddles the new year; the span is built from both dates, so the
    // December label and the January days both land in the same selection.
    { year: 2024, start: '2024-12-25', end: '2025-01-02' },
    { year: 2025, start: '2025-12-14', end: '2025-12-22' },
    { year: 2026, start: '2026-12-04', end: '2026-12-12' },
  ],
}

/** Years the table covers, and therefore the years every event offers. */
export const EVENT_YEARS: number[] = HOLIDAYS.pessah.map((h) => h.year)

export interface QuickEvent {
  id: string
  label: string
}

export const QUICK_EVENTS: QuickEvent[] = [
  { id: 'pessah', label: 'Pessah' },
  { id: 'souccot', label: 'Souccot' },
  { id: 'hanouka', label: 'Hanouka' },
  { id: 'ete', label: 'Été' },
  { id: 'hiver', label: 'Hiver' },
]

/**
 * `YYYY-MM-DD` → local midnight. Deliberately not `new Date(str)`: that parses a
 * bare date as UTC, which in any negative-offset zone lands on the previous day
 * and would shift every holiday a day early.
 */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Days of slack on either side of a holiday. The photos people actually want
 * are rarely confined to the festival itself — travelling out, the shopping and
 * cooking the day before, the drive home after — so the table's exact dates are
 * a poor edge for a *media* filter. Applied to the holidays only: a season is
 * already an approximate window, and padding June would just bleed into May.
 */
const HOLIDAY_PAD_DAYS = 3

function spanFrom(startIso: string, endIso: string): DateSpan {
  // addDays is calendar arithmetic rather than ±n×86 400 000, so a DST switch
  // inside the padding cannot shift the edge by an hour.
  return {
    from: startOfDay(addDays(localDate(startIso).getTime(), -HOLIDAY_PAD_DAYS)),
    to: endOfDay(addDays(localDate(endIso).getTime(), HOLIDAY_PAD_DAYS)),
  }
}

/** Summer: 1 June – 31 August. Winter: 1 January – end of February (leap-safe,
 *  since day 0 of March is the last day of February). */
function seasonSpan(eventId: string, year: number): DateSpan | null {
  if (eventId === 'ete') {
    return { from: startOfDay(new Date(year, 5, 1).getTime()), to: endOfDay(new Date(year, 7, 31).getTime()) }
  }
  if (eventId === 'hiver') {
    return { from: startOfDay(new Date(year, 0, 1).getTime()), to: endOfDay(new Date(year, 2, 0).getTime()) }
  }
  return null
}

/**
 * The spans for one event. `year` of `'all'` returns every year's span — which
 * is why the date filter has to hold a list: seven separate weeks spread over
 * seven years cannot be expressed as one range.
 */
export function eventSpans(eventId: string, year: number | 'all'): DateSpan[] {
  const years = year === 'all' ? EVENT_YEARS : [year]
  const holiday = HOLIDAYS[eventId]
  if (holiday) {
    return years
      .map((y) => holiday.find((h) => h.year === y))
      .filter((h): h is HolidayYear => !!h)
      .map((h) => spanFrom(h.start, h.end))
  }
  return years.map((y) => seasonSpan(eventId, y)).filter((s): s is DateSpan => !!s)
}

export function eventLabel(eventId: string, year: number | 'all'): string {
  const name = QUICK_EVENTS.find((e) => e.id === eventId)?.label ?? eventId
  return year === 'all' ? `${name} · toutes les années` : `${name} ${year}`
}
