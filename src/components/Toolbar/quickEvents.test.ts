// src/components/Toolbar/quickEvents.test.ts
// Pinned to a negative-offset zone: a bare "YYYY-MM-DD" parsed as UTC lands on
// the previous day here, which would shift every holiday a day early.
process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import { EVENT_YEARS, QUICK_EVENTS, eventLabel, eventSpans } from './quickEvents'
import { filteredMedia } from '../../store/selectors'
import { EMPTY_FILTERS } from '../../store/useChatStore'
import type { MediaItem } from '../../types'

const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function item(iso: string, id = iso): MediaItem {
  const [y, m, d] = iso.split('-').map(Number)
  return {
    id,
    kind: 'photo',
    filename: `${id}.jpg`,
    size: 1,
    caption: '',
    sender: 'Ana',
    timestampMs: new Date(y, m - 1, d, 12, 0).getTime(),
    anchorMessageId: id,
    starred: false,
    missing: false,
  }
}

describe('timezone guard', () => {
  it('runs in the pinned zone', () => {
    expect(new Date(2025, 6, 1).getTimezoneOffset()).toBe(240)
  })
})

describe('eventSpans', () => {
  it('returns one span per year for a holiday across all years', () => {
    const spans = eventSpans('pessah', 'all')
    expect(spans).toHaveLength(EVENT_YEARS.length)
    // This is the whole reason the filter holds a list: seven separate weeks
    // spread over seven years cannot be written as one range.
    expect(spans.length).toBeGreaterThan(1)
  })

  // Pessah 2025 runs 04-12 → 04-19 in the table; the filter widens it by three
  // days each way to catch the travelling and cooking either side.
  it('pads a holiday by three days on each side, from the table dates', () => {
    const [span] = eventSpans('pessah', 2025)
    expect(dayOf(span.from)).toBe('2025-04-09')
    expect(dayOf(span.to)).toBe('2025-04-22')
  })

  it('covers the full last padded day, so evening items are not dropped', () => {
    const [span] = eventSpans('pessah', 2025)
    const lastEvening = new Date(2025, 3, 22, 23, 30).getTime()
    expect(lastEvening).toBeLessThanOrEqual(span.to)
    // One minute into the next day is out.
    expect(new Date(2025, 3, 23, 0, 1).getTime()).toBeGreaterThan(span.to)
  })

  it('spans the new year for a holiday that straddles it, padding included', () => {
    const [span] = eventSpans('hanouka', 2024)
    expect(dayOf(span.from)).toBe('2024-12-22')
    expect(dayOf(span.to)).toBe('2025-01-05')
  })

  // A season is already an approximate window; padding it would bleed June into
  // May and make "Été" mean something the label does not say.
  it('leaves the seasons unpadded', () => {
    expect(dayOf(eventSpans('ete', 2023)[0].from)).toBe('2023-06-01')
    expect(dayOf(eventSpans('ete', 2023)[0].to)).toBe('2023-08-31')
    expect(dayOf(eventSpans('hiver', 2023)[0].from)).toBe('2023-01-01')
  })

  // The padding must not silently merge two years into one another; holidays
  // are a year apart, so every span stays disjoint.
  it('keeps every year separate after padding', () => {
    const spans = [...eventSpans('pessah', 'all')].sort((a, b) => a.from - b.from)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].from).toBeGreaterThan(spans[i - 1].to)
    }
  })

  it('builds summer as June through August', () => {
    const [span] = eventSpans('ete', 2023)
    expect(dayOf(span.from)).toBe('2023-06-01')
    expect(dayOf(span.to)).toBe('2023-08-31')
  })

  it('builds winter as January through the end of February, leap year included', () => {
    expect(dayOf(eventSpans('hiver', 2023)[0].to)).toBe('2023-02-28')
    expect(dayOf(eventSpans('hiver', 2024)[0].to)).toBe('2024-02-29')
  })

  it('offers every event in the picker', () => {
    for (const ev of QUICK_EVENTS) {
      expect(eventSpans(ev.id, 'all').length).toBe(EVENT_YEARS.length)
    }
  })

  it('labels a single year and an all-years selection differently', () => {
    expect(eventLabel('pessah', 2025)).toContain('2025')
    expect(eventLabel('pessah', 'all')).toMatch(/toutes/i)
  })
})

describe('filtering by quick-event spans', () => {
  const media = [
    item('2024-04-25', 'pessah24'), // inside Pessah 2024
    item('2025-04-14', 'pessah25'), // inside Pessah 2025
    item('2025-04-09', 'eve25'), // 3 days before it starts — inside the padding
    item('2025-04-22', 'tail25'), // 3 days after it ends — inside the padding
    item('2025-04-30', 'after25'), // well clear of Pessah 2025
    item('2025-07-04', 'summer25'), // summer
  ]

  // The reason for the padding: the drive out and the drive home are part of
  // the occasion, and their photos sit just outside the festival's own dates.
  it('reaches three days either side of the holiday', () => {
    const kept = filteredMedia(media, { ...EMPTY_FILTERS, dateSpans: eventSpans('pessah', 2025) })
    expect(kept.map((m) => m.id).sort()).toEqual(['eve25', 'pessah25', 'tail25'])
  })

  it('still stops short of a day well outside the holiday', () => {
    const kept = filteredMedia(media, { ...EMPTY_FILTERS, dateSpans: eventSpans('pessah', 2025) })
    expect(kept.map((m) => m.id)).not.toContain('after25')
  })

  it('keeps only items from the chosen year', () => {
    const kept = filteredMedia(media, { ...EMPTY_FILTERS, dateSpans: eventSpans('pessah', 2025) })
    expect(kept.map((m) => m.id).sort()).toEqual(['eve25', 'pessah25', 'tail25'])
    expect(kept.map((m) => m.id)).not.toContain('pessah24')
  })

  it('keeps items from every year when all years are chosen', () => {
    const kept = filteredMedia(media, { ...EMPTY_FILTERS, dateSpans: eventSpans('pessah', 'all') })
    expect(kept.map((m) => m.id).sort()).toEqual(['eve25', 'pessah24', 'pessah25', 'tail25'])
  })

  it('does not leak the gap between two spans', () => {
    // The naive "min start to max end" reading of "all Pessah" would span
    // 2020→2026 and match everything, including this April-30 item.
    const kept = filteredMedia(media, { ...EMPTY_FILTERS, dateSpans: eventSpans('pessah', 'all') })
    expect(kept.map((m) => m.id)).not.toContain('after25')
    expect(kept.map((m) => m.id)).not.toContain('summer25')
  })

  it('composes with the other filter dimensions', () => {
    const kept = filteredMedia(media, {
      ...EMPTY_FILTERS,
      dateSpans: eventSpans('pessah', 'all'),
      senders: ['Nobody'],
    })
    expect(kept).toEqual([])
  })

  // The two are alternative spellings of the same "when" filter; intersecting
  // them would mean "every Pessah, but also only in this one month".
  it('takes precedence over a single from/to range', () => {
    const kept = filteredMedia(media, {
      ...EMPTY_FILTERS,
      dateSpans: eventSpans('pessah', 2025),
      dateFrom: new Date(2020, 0, 1).getTime(),
      dateTo: new Date(2020, 0, 2).getTime(),
    })
    expect(kept.map((m) => m.id).sort()).toEqual(['eve25', 'pessah25', 'tail25'])
  })

  it('leaves the single range in charge when no event is selected', () => {
    const kept = filteredMedia(media, {
      ...EMPTY_FILTERS,
      dateFrom: new Date(2025, 6, 1).getTime(),
      dateTo: new Date(2025, 6, 31, 23, 59).getTime(),
    })
    expect(kept.map((m) => m.id)).toEqual(['summer25'])
  })
})
