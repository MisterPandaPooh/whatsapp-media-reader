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

  it('parses German dot format', () => {
    const r = matchDatePrefix('03.09.2025, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    const d = new Date(r!.timestampMs)
    expect(d.getDate()).toBe(3)
    expect(d.getMonth()).toBe(8) // September = index 8
    expect(d.getFullYear()).toBe(2025)
    expect(d.getHours()).toBe(20)
  })

  it('parses dash format', () => {
    const r = matchDatePrefix('03-09-2025, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    const d = new Date(r!.timestampMs)
    expect(d.getDate()).toBe(3)
    expect(d.getMonth()).toBe(8) // September = index 8
    expect(d.getFullYear()).toBe(2025)
    expect(d.getHours()).toBe(20)
  })

  it('parses Asian 12h format (YYYY/MM/DD)', () => {
    const r = matchDatePrefix('2025/9/3, 8:14 AM - Ana: hi')
    expect(r).not.toBeNull()
    const d = new Date(r!.timestampMs)
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(8) // September = index 8
    expect(d.getDate()).toBe(3)
    expect(d.getHours()).toBe(8)
  })

  it('parses Asian 24h format (YYYY/MM/DD)', () => {
    const r = matchDatePrefix('2025/9/3, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    const d = new Date(r!.timestampMs)
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(8) // September = index 8
    expect(d.getDate()).toBe(3)
    expect(d.getHours()).toBe(20)
  })

  it('parses iOS bracketed 24h format with seconds', () => {
    const r = matchDatePrefix('[3/9/25, 20:14:07] Ana: hi')
    expect(r).not.toBeNull()
    const d = new Date(r!.timestampMs)
    expect(d.getHours()).toBe(20)
    expect(d.getSeconds()).toBe(7)
    expect(r!.rest).toBe('Ana: hi')
  })

  it('handles the noon/midnight AM-PM edge case', () => {
    const midnight = matchDatePrefix('1/1/25, 12:00 AM - A: x')
    const noon = matchDatePrefix('1/1/25, 12:00 PM - A: x')
    expect(midnight).not.toBeNull()
    expect(noon).not.toBeNull()
    expect(new Date(midnight!.timestampMs).getHours()).toBe(0)
    expect(new Date(noon!.timestampMs).getHours()).toBe(12)
  })

  it('returns null for a non-matching line', () => {
    expect(matchDatePrefix('just a continuation line')).toBeNull()
  })
})

// A real iOS export starts every line with U+200E. It is invisible and, being a
// format character rather than a space, survives both `\s` and `trim()` — so
// without stripping it the `^`-anchored patterns never match and every line is
// swallowed as a continuation of the one before it.
describe('leading bidi marks (real iOS exports)', () => {
  const LTR = '‎'

  it('parses an iOS bracketed line that begins with a left-to-right mark', () => {
    const r = matchDatePrefix(`${LTR}[29/07/2026, 14:01:39] Nina Duval: hello`)
    expect(r).not.toBeNull()
    expect(r!.rest).toBe('Nina Duval: hello')
    const d = new Date(r!.timestampMs)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6) // July
    expect(d.getDate()).toBe(29)
    expect(d.getSeconds()).toBe(39)
  })

  it('parses a non-bracketed line that begins with a mark', () => {
    const r = matchDatePrefix(`${LTR}09/03/2025, 20:14 - Ana: hi`)
    expect(r).not.toBeNull()
    expect(r!.rest).toBe('Ana: hi')
  })

  it('does not carry the mark into the remainder', () => {
    const r = matchDatePrefix(`${LTR}${LTR}[29/07/2026, 14:01:39] Nina: x`)
    expect(r!.rest.startsWith(LTR)).toBe(false)
  })

  it('still returns null for a genuine continuation line', () => {
    expect(matchDatePrefix(`${LTR}just a wrapped line of text`)).toBeNull()
  })
})
