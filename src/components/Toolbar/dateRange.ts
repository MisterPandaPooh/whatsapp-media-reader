// src/components/Toolbar/dateRange.ts
//
// Day/month arithmetic for the toolbar's date filter.
//
// Every boundary here is computed with the Date(y, m, d) constructor rather than
// by adding milliseconds. Days are not all 86_400_000 ms long: under a DST
// fall-back a day is 25h (so `startOfDay + 86_399_999` lands at 22:59:59 and the
// filter silently drops that hour of media), and under spring-forward it is 23h
// (so the same expression overshoots into the next day). Calendar arithmetic is
// correct by construction in every zone.

export const PRESETS = ['All time', 'Last 7 days', 'Last 30 days', 'This month'] as const
export type Preset = (typeof PRESETS)[number]

export interface DateRange {
  dateFrom: number | null
  dateTo: number | null
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Last representable instant of the local calendar day containing `ms`. */
export function endOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1
}

/** Start of the local calendar day `delta` days from the one containing `ms`. */
export function addDays(ms: number, delta: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta).getTime()
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function addMonths(ms: number, delta: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime()
}

/**
 * Resolve a preset against `anchorMs` — the newest item in the export, not
 * `Date.now()`. A chat export is historical data: anchoring to the current clock
 * would make every "last N days" preset return nothing for an old export.
 * Windows are inclusive of both end days.
 */
export function presetRange(preset: Preset, anchorMs: number): DateRange {
  switch (preset) {
    case 'All time':
      return { dateFrom: null, dateTo: null }
    case 'Last 7 days':
      return { dateFrom: addDays(anchorMs, -6), dateTo: endOfDay(anchorMs) }
    case 'Last 30 days':
      return { dateFrom: addDays(anchorMs, -29), dateTo: endOfDay(anchorMs) }
    case 'This month':
      return { dateFrom: startOfMonth(anchorMs), dateTo: endOfDay(anchorMs) }
  }
}

/** Inclusive range covering both days, in either click order. */
export function rangeBetween(aMs: number, bMs: number): DateRange {
  const [from, to] = aMs <= bMs ? [aMs, bMs] : [bMs, aMs]
  return { dateFrom: startOfDay(from), dateTo: endOfDay(to) }
}
