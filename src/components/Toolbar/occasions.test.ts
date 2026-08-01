// Pinned like quickEvents.test.ts: a bare "YYYY-MM-DD" parsed as UTC lands on
// the previous day in a negative-offset zone.
process.env.TZ = 'America/New_York'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OCCASIONS,
  OCCASIONS_STORAGE_KEY,
  loadOccasions,
  parseOccasions,
} from './occasions'
import { eventLabel, eventSpans, eventYears, quickEvents } from './quickEvents'

const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('parseOccasions', () => {
  it('accepts a dated occasion', () => {
    const cfg = parseOccasions(
      JSON.stringify({
        padDays: 1,
        occasions: [{ id: 'x', label: 'X', dates: [{ year: 2024, start: '2024-05-01', end: '2024-05-03' }] }],
      }),
    )
    expect(cfg?.occasions[0].label).toBe('X')
    expect(cfg?.padDays).toBe(1)
  })

  it('accepts a seasonal occasion', () => {
    const cfg = parseOccasions(
      JSON.stringify({ occasions: [{ id: 's', label: 'S', season: { from: '06-01', to: '08-31' } }] }),
    )
    expect(cfg?.occasions[0].season).toEqual({ from: '06-01', to: '08-31' })
  })

  it('falls back to the default padding when it is missing or nonsense', () => {
    const body = { occasions: [{ id: 's', label: 'S', season: { from: '06-01', to: '08-31' } }] }
    expect(parseOccasions(JSON.stringify(body))?.padDays).toBe(DEFAULT_OCCASIONS.padDays)
    expect(parseOccasions(JSON.stringify({ ...body, padDays: -4 }))?.padDays).toBe(DEFAULT_OCCASIONS.padDays)
  })

  it.each([
    ['not json at all', 'not json at all'],
    ['a bare array', '[]'],
    ['no occasions', '{"occasions":[]}'],
    ['an occasion with no id', '{"occasions":[{"label":"X","season":{"from":"06-01","to":"08-31"}}]}'],
    ['a malformed date', '{"occasions":[{"id":"x","label":"X","dates":[{"year":2024,"start":"1/5/24","end":"2024-05-03"}]}]}'],
    ['a malformed season', '{"occasions":[{"id":"x","label":"X","season":{"from":"June","to":"08-31"}}]}'],
    ['an occasion with neither dates nor season', '{"occasions":[{"id":"x","label":"X"}]}'],
  ])('rejects %s', (_name, raw) => {
    expect(parseOccasions(raw)).toBeNull()
  })
})

describe('loadOccasions', () => {
  it('returns the built-in list when nothing is stored', () => {
    expect(loadOccasions()).toBe(DEFAULT_OCCASIONS)
  })

  it('keeps working — loudly — when the stored value is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(OCCASIONS_STORAGE_KEY, '{ broken')

    expect(loadOccasions()).toBe(DEFAULT_OCCASIONS)
    expect(warn).toHaveBeenCalled()
  })
})

describe('an occasion list supplied from localStorage', () => {
  const custom = {
    padDays: 0,
    occasions: [
      { id: 'noel', label: 'Noël', dates: [{ year: 2024, start: '2024-12-24', end: '2024-12-25' }] },
      { id: 'printemps', label: 'Printemps', season: { from: '03-01', to: '05-31' } },
    ],
  }

  it('replaces the built-in occasions and their years', () => {
    localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(custom))

    expect(quickEvents()).toEqual([
      { id: 'noel', label: 'Noël' },
      { id: 'printemps', label: 'Printemps' },
    ])
    expect(eventYears()).toEqual([2024])
    expect(eventLabel('noel', 2024)).toBe('Noël 2024')
  })

  it('honours its own padding', () => {
    localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(custom))
    const [span] = eventSpans('noel', 2024)

    expect(dayOf(span.from)).toBe('2024-12-24')
    expect(dayOf(span.to)).toBe('2024-12-25')
  })

  it('resolves a season against the year list', () => {
    localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(custom))
    const [span] = eventSpans('printemps', 2024)

    expect(dayOf(span.from)).toBe('2024-03-01')
    expect(dayOf(span.to)).toBe('2024-05-31')
  })

  it('returns nothing for an occasion the list does not define', () => {
    localStorage.setItem(OCCASIONS_STORAGE_KEY, JSON.stringify(custom))
    expect(eventSpans('pessah', 'all')).toEqual([])
  })
})

describe('the built-in winter season', () => {
  it('ends on the last day of February in a leap year and outside one', () => {
    expect(dayOf(eventSpans('hiver', 2024)[0].to)).toBe('2024-02-29')
    expect(dayOf(eventSpans('hiver', 2025)[0].to)).toBe('2025-02-28')
  })
})
