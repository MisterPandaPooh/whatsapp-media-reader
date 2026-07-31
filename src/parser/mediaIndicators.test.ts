import { describe, it, expect } from 'vitest'
import { extractMediaFilename, isSystemMessage, detectKind, stripMediaMarker } from './mediaIndicators'

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

describe('stripMediaMarker', () => {
  it('strips a bare iOS <attached: ...> marker to an empty string', () => {
    expect(stripMediaMarker('<attached: 00001-PHOTO.jpg>')).toBe('')
  })
  it('strips an iOS marker preceded by the LTR mark iOS inserts', () => {
    expect(stripMediaMarker('‎<attached: 00001-PHOTO.jpg>')).toBe('')
  })
  it('keeps a caption that follows an iOS marker', () => {
    expect(stripMediaMarker('<attached: 00001-PHOTO.jpg>\nsunset at the beach')).toBe('sunset at the beach')
  })
  it('keeps a caption that precedes an iOS marker', () => {
    expect(stripMediaMarker('sunset at the beach <attached: 00001-PHOTO.jpg>')).toBe('sunset at the beach')
  })
  it('keeps caption text on both sides of an iOS marker', () => {
    expect(stripMediaMarker('look <attached: 00001-PHOTO.jpg> at this')).toBe('look at this')
  })
  it('strips a bare Android "(file attached)" marker to an empty string', () => {
    expect(stripMediaMarker('IMG-20250903-WA0012.jpg (file attached)')).toBe('')
  })
  it('keeps a caption that follows an Android marker', () => {
    expect(stripMediaMarker('IMG-20250903-WA0012.jpg (file attached)\nsunset at the beach')).toBe('sunset at the beach')
  })
  it('keeps a caption that precedes an Android marker', () => {
    expect(stripMediaMarker('sunset at the beach\nIMG-20250903-WA0012.jpg (file attached)')).toBe('sunset at the beach')
  })
  it('strips localized Android markers', () => {
    expect(stripMediaMarker('IMG-1.jpg (arquivo anexado)\nbom dia')).toBe('bom dia')
  })
  it('drops the marker line entirely when it sits between two caption lines', () => {
    expect(stripMediaMarker('before\n<attached: a.jpg>\nafter')).toBe('before\nafter')
  })
  it('returns text with no marker unchanged', () => {
    expect(stripMediaMarker('just chatting')).toBe('just chatting')
  })
  it('leaves user text containing parentheses intact', () => {
    expect(stripMediaMarker('dinner (with Ana) was great')).toBe('dinner (with Ana) was great')
  })
  it('leaves user text containing angle brackets intact', () => {
    expect(stripMediaMarker('use <div> for the wrapper')).toBe('use <div> for the wrapper')
  })
  it('leaves a multiline caption with no marker untouched', () => {
    expect(stripMediaMarker('first line\n\nsecond line')).toBe('first line\n\nsecond line')
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
  it('does not flag ordinary sentences containing "left"', () => {
    expect(isSystemMessage('I left my keys at home')).toBe(false)
  })
  it('does not flag ordinary sentences containing "added"', () => {
    expect(isSystemMessage('just added the photos')).toBe(false)
  })
  it('does not flag ordinary sentences containing "removed"', () => {
    expect(isSystemMessage('he removed himself from the trip')).toBe(false)
  })
})
