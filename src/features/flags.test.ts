import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLAGS, isEnabled } from './flags'

afterEach(() => {
  // Order matters: the throwing stub has no clear().
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('isEnabled', () => {
  it('is off when the key was never set', () => {
    expect(isEnabled('occasions')).toBe(false)
  })

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'ON', ' True '])('is on for %j', (value) => {
    localStorage.setItem(FLAGS.occasions, value)
    expect(isEnabled('occasions')).toBe(true)
  })

  it.each(['0', 'false', 'off', '', 'maybe'])('is off for %j', (value) => {
    localStorage.setItem(FLAGS.occasions, value)
    expect(isEnabled('occasions')).toBe(false)
  })

  it('sees a flag set after the module was loaded', () => {
    expect(isEnabled('occasions')).toBe(false)
    localStorage.setItem(FLAGS.occasions, 'on')
    // Nothing to invalidate: the value is read at call time, so a flag flipped
    // from the console does not need a cache cleared to take effect.
    expect(isEnabled('occasions')).toBe(true)
  })

  it('reads as off when localStorage itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    expect(isEnabled('occasions')).toBe(false)
  })
})
