import { describe, it, expect } from 'vitest'
import { matchDatePrefix } from './dateFormats'

describe('matchDatePrefix', () => {
  it('parses US 12h format', () => {
    const r = matchDatePrefix('3/9/25, 8:14 AM - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getFullYear()).toBe(2025)
    expect(new Date(r!.timestampMs).getHours()).toBe(8)
    expect(r!.rest).toBe('Ana: hi')
  })

  it('parses EU 24h format', () => {
    const r = matchDatePrefix('09/03/2025, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getMonth()).toBe(2) // March = index 2
    expect(new Date(r!.timestampMs).getHours()).toBe(20)
  })

  it('parses ISO format', () => {
    const r = matchDatePrefix('2025-09-03, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getFullYear()).toBe(2025)
  })

  it('parses iOS bracketed 12h format with seconds', () => {
    const r = matchDatePrefix('[3/9/25, 8:14:07 AM] Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getSeconds()).toBe(7)
    expect(r!.rest).toBe('Ana: hi')
  })

  it('returns null for a non-matching line', () => {
    expect(matchDatePrefix('just a continuation line')).toBeNull()
  })
})
