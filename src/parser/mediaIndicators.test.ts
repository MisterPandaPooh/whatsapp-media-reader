import { describe, it, expect } from 'vitest'
import { extractMediaFilename, isSystemMessage, detectKind } from './mediaIndicators'

describe('extractMediaFilename', () => {
  it('extracts from iOS <attached: ...> marker', () => {
    expect(extractMediaFilename('<attached: 00001-PHOTO.jpg>')).toBe('00001-PHOTO.jpg')
  })
  it('extracts from Android "(file attached)" marker', () => {
    expect(extractMediaFilename('IMG-20250903-WA0012.jpg (file attached)')).toBe('IMG-20250903-WA0012.jpg')
  })
  it('returns null for plain text', () => {
    expect(extractMediaFilename('just chatting')).toBeNull()
  })
})

describe('detectKind', () => {
  it('detects photo from extension', () => { expect(detectKind('a.jpg')).toBe('photo') })
  it('detects video from extension', () => { expect(detectKind('a.mp4')).toBe('video') })
  it('detects voice from extension', () => { expect(detectKind('a.opus')).toBe('voice') })
  it('detects doc from extension', () => { expect(detectKind('a.pdf')).toBe('doc') })
  it('defaults unknown extensions to doc', () => { expect(detectKind('a.xyz')).toBe('doc') })
})

describe('isSystemMessage', () => {
  it('flags group-created lines', () => {
    expect(isSystemMessage('Ana created group "Lisbon Trip"')).toBe(true)
  })
  it('does not flag a normal message', () => {
    expect(isSystemMessage('Landing at 14:20, anyone on the same flight?')).toBe(false)
  })
})
