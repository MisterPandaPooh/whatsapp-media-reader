// src/components/Toolbar/dateRange.test.ts
// Pinned to a DST-observing zone: these boundaries are only wrong on days that
// aren't 24h long, so a zone without DST (or a UTC CI box) would pass vacuously.
process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import { addDays, endOfDay, presetRange, rangeBetween, startOfDay } from './dateRange'

/** Local wall-clock fields, so assertions read as the dates a user would see. */
function fields(ms: number) {
  const d = new Date(ms)
  return {
    y: d.getFullYear(),
    m: d.getMonth(),
    day: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes(),
    s: d.getSeconds(),
    msec: d.getMilliseconds(),
  }
}

describe('dateRange', () => {
  it('runs in the pinned DST-observing zone', () => {
    // Guards the whole suite: without this, a zone mismatch would make every
    // DST assertion below pass for the wrong reason.
    expect(new Date(2025, 6, 1).getTimezoneOffset()).toBe(240) // EDT
    expect(new Date(2025, 0, 1).getTimezoneOffset()).toBe(300) // EST
  })

  it('ends the day at 23:59:59.999 on a 25-hour fall-back day', () => {
    // 2025-11-02 is 25h long in America/New_York. Millisecond arithmetic
    // (startOfDay + 86_399_999) lands at 22:59:59.999 and drops the 23:00 hour.
    const noon = new Date(2025, 10, 2, 12).getTime()
    expect(fields(endOfDay(noon))).toEqual({ y: 2025, m: 10, day: 2, h: 23, min: 59, s: 59, msec: 999 })
  })

  it('does not spill into the next day on a 23-hour spring-forward day', () => {
    // 2026-03-08 is 23h long; millisecond arithmetic overshoots to Mar 9 00:59:59.999.
    const noon = new Date(2026, 2, 8, 12).getTime()
    expect(fields(endOfDay(noon))).toEqual({ y: 2026, m: 2, day: 8, h: 23, min: 59, s: 59, msec: 999 })
  })

  it('keeps an item logged at 23:30 on a fall-back day inside that day', () => {
    // The actual data-loss case: filteredMedia drops anything past dateTo.
    const item = new Date(2025, 10, 2, 23, 30).getTime()
    expect(item).toBeLessThanOrEqual(endOfDay(item))
    expect(item).toBeGreaterThanOrEqual(startOfDay(item))
  })

  it('steps whole calendar days across a DST transition', () => {
    // Early-morning and late-evening anchors are where ms arithmetic slips a day:
    // spring-forward makes 6*24h reach back to Mar 3 23:30, fall-back makes 3*24h
    // reach back to Nov 2 00:30. Both must still land on the right calendar day.
    expect(fields(addDays(new Date(2026, 2, 10, 0, 30).getTime(), -6))).toMatchObject({ m: 2, day: 4, h: 0 })
    expect(fields(addDays(new Date(2025, 10, 4, 23, 30).getTime(), -3))).toMatchObject({ m: 10, day: 1, h: 0 })
  })

  it('resolves "Last 7 days" to exactly 7 calendar days across spring-forward', () => {
    // Millisecond arithmetic yields Mar 3 here — an 8-day window.
    const anchor = new Date(2026, 2, 10, 0, 30).getTime()
    const { dateFrom, dateTo } = presetRange('Last 7 days', anchor)
    expect(fields(dateFrom as number)).toMatchObject({ y: 2026, m: 2, day: 4, h: 0, min: 0 })
    expect(fields(dateTo as number)).toMatchObject({ y: 2026, m: 2, day: 10, h: 23, min: 59, s: 59 })
    // Exactly 7 distinct calendar days, not 8.
    let days = 0
    for (let t = dateFrom as number; t <= (dateTo as number); t = addDays(t, 1)) days++
    expect(days).toBe(7)
  })

  it('resolves "Last 30 days" to exactly 30 calendar days across fall-back', () => {
    // Late-evening anchor: ms arithmetic gains an hour crossing back over the
    // fall-back and lands on Oct 23, losing a day off the front of the window.
    const anchor = new Date(2025, 10, 20, 23, 30).getTime()
    const { dateFrom, dateTo } = presetRange('Last 30 days', anchor)
    expect(fields(dateFrom as number)).toMatchObject({ y: 2025, m: 9, day: 22, h: 0 })
    expect(fields(dateTo as number)).toMatchObject({ y: 2025, m: 10, day: 20, h: 23, min: 59, s: 59 })
  })

  it('anchors presets to the export, not the current clock', () => {
    const anchor = new Date(2019, 5, 15, 10).getTime()
    const { dateFrom, dateTo } = presetRange('This month', anchor)
    expect(fields(dateFrom as number)).toMatchObject({ y: 2019, m: 5, day: 1, h: 0 })
    expect(fields(dateTo as number)).toMatchObject({ y: 2019, m: 5, day: 15, h: 23 })
  })

  it('returns an open range for "All time"', () => {
    expect(presetRange('All time', Date.now())).toEqual({ dateFrom: null, dateTo: null })
  })

  it('builds an inclusive range from two picked days in either order', () => {
    const a = new Date(2025, 10, 2, 4).getTime() // fall-back day
    const b = new Date(2025, 10, 6, 19).getTime()
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const { dateFrom, dateTo } = rangeBetween(x, y)
      expect(fields(dateFrom as number)).toMatchObject({ m: 10, day: 2, h: 0, min: 0 })
      expect(fields(dateTo as number)).toMatchObject({ m: 10, day: 6, h: 23, min: 59, s: 59 })
    }
  })

  it('makes a single picked day cover its whole 25-hour span', () => {
    const day = new Date(2025, 10, 2).getTime()
    const { dateFrom, dateTo } = rangeBetween(day, day)
    expect((dateTo as number) - (dateFrom as number) + 1).toBe(25 * 60 * 60 * 1000)
  })
})
