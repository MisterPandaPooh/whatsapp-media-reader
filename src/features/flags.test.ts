import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAGS, isEnabled } from './flags'

afterEach(() => {
  // Order matters: the throwing stub has no clear().
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('isEnabled', () => {
  it('falls back to the flag’s default when the key was never set', () => {
    expect(isEnabled('occasions')).toBe(FLAGS.occasions.default)
  })

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'ON', ' True '])('is on for %j', (value) => {
    localStorage.setItem(FLAGS.occasions.key, value)
    expect(isEnabled('occasions')).toBe(true)
  })

  it.each(['0', 'false', 'off', 'no', 'disabled', 'OFF', ' False '])('is off for %j', (value) => {
    localStorage.setItem(FLAGS.occasions.key, value)
    expect(isEnabled('occasions')).toBe(false)
  })

  it.each(['', 'maybe', 'yes please'])('falls back to the default for %j', (value) => {
    // A value nobody recognises must not silently pick a side — a typo in a
    // hand-typed console command would otherwise turn a feature off for good
    // with no way to tell that it had.
    localStorage.setItem(FLAGS.occasions.key, value)
    expect(isEnabled('occasions')).toBe(FLAGS.occasions.default)
  })

  it('sees a flag set after the module was loaded', () => {
    localStorage.setItem(FLAGS.occasions.key, 'off')
    expect(isEnabled('occasions')).toBe(false)
    localStorage.setItem(FLAGS.occasions.key, 'on')
    // Nothing to invalidate: the value is read at call time, so a flag flipped
    // from the console does not need a cache cleared to take effect.
    expect(isEnabled('occasions')).toBe(true)
  })

  it('falls back to the default when localStorage itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    expect(isEnabled('occasions')).toBe(FLAGS.occasions.default)
  })
})

describe('the occasions flag', () => {
  it('is on out of the box', () => {
    expect(FLAGS.occasions.default).toBe(true)
    expect(isEnabled('occasions')).toBe(true)
  })
})
