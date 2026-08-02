import { addDays, endOfDay, startOfDay } from './dateRange'
import { loadOccasions, type Occasion, type OccasionsConfig } from './occasions'
import type { DateSpan } from '../../store/useChatStore'

export interface QuickEvent {
  id: string
  label: string
}

/**
 * `YYYY-MM-DD` → local midnight. Deliberately not `new Date(str)`: that parses a
 * bare date as UTC, which in any negative-offset zone lands on the previous day
 * and would shift every occasion a day early.
 */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * A recurring `MM-DD` in a given year. The day is clamped to the length of the
 * month, which is what makes `02-29` mean "end of February" in every year
 * rather than silently rolling over into March.
 */
function monthDay(year: number, md: string, edge: 'start' | 'end'): number {
  const [m, d] = md.split('-').map(Number)
  const lastOfMonth = new Date(year, m, 0).getDate()
  const day = Math.min(d, lastOfMonth)
  const ms = new Date(year, m - 1, day).getTime()
  return edge === 'start' ? startOfDay(ms) : endOfDay(ms)
}

function spanFromDates(startIso: string, endIso: string, padDays: number): DateSpan {
  // addDays is calendar arithmetic rather than ±n×86 400 000, so a DST switch
  // inside the padding cannot shift the edge by an hour.
  return {
    from: startOfDay(addDays(localDate(startIso).getTime(), -padDays)),
    to: endOfDay(addDays(localDate(endIso).getTime(), padDays)),
  }
}

/** Years the config offers: whatever it states, else every year its dated
 *  occasions mention, ascending. */
function yearsOf(config: OccasionsConfig): number[] {
  if (config.years) return [...config.years].sort((a, b) => a - b)
  const years = new Set<number>()
  for (const o of config.occasions) for (const d of o.dates ?? []) years.add(d.year)
  return [...years].sort((a, b) => a - b)
}

function spansOf(occasion: Occasion, years: number[], padDays: number): DateSpan[] {
  if (occasion.season) {
    return years.map((y) => ({
      from: monthDay(y, occasion.season!.from, 'start'),
      to: monthDay(y, occasion.season!.to, 'end'),
    }))
  }
  return years
    .map((y) => occasion.dates?.find((d) => d.year === y))
    .filter((d) => !!d)
    .map((d) => spanFromDates(d.start, d.end, padDays))
}

/** The occasions to offer, in order. Empty when the feature is not configured. */
export function quickEvents(): QuickEvent[] {
  return loadOccasions().occasions.map((o) => ({ id: o.id, label: o.label }))
}

/** Years every occasion offers. */
export function eventYears(): number[] {
  return yearsOf(loadOccasions())
}

/**
 * The spans for one occasion. `year` of `'all'` returns every year's span —
 * which is why the date filter has to hold a list: seven separate weeks spread
 * over seven years cannot be expressed as one range.
 */
export function eventSpans(eventId: string, year: number | 'all'): DateSpan[] {
  const config = loadOccasions()
  const occasion = config.occasions.find((o) => o.id === eventId)
  if (!occasion) return []
  const years = year === 'all' ? yearsOf(config) : [year]
  return spansOf(occasion, years, config.padDays)
}

export function eventLabel(eventId: string, year: number | 'all'): string {
  const name = loadOccasions().occasions.find((o) => o.id === eventId)?.label ?? eventId
  return year === 'all' ? `${name} · all years` : `${name} ${year}`
}
