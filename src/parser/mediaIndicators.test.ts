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

  // Document names routinely contain spaces; a filename regex that stops at the
  // first whitespace returns only the last word, which then fails to match any
  // file on disk (tile shows "Missing") and leaks the remnant into the caption.
  it('keeps spaces in an Android marker filename', () => {
    expect(extractMediaFilename('Q1 Budget Review.pdf (file attached)')).toBe('Q1 Budget Review.pdf')
  })
  it('keeps spaces in an Android marker filename with digits', () => {
    expect(extractMediaFilename('Trip Photos 2026.zip (file attached)')).toBe('Trip Photos 2026.zip')
  })
  it('keeps a single embedded space in an Android marker filename', () => {
    expect(extractMediaFilename('my report.docx (file attached)')).toBe('my report.docx')
  })
  it('keeps spaces in an iOS marker filename', () => {
    expect(extractMediaFilename('<attached: Q1 Budget Review.pdf>')).toBe('Q1 Budget Review.pdf')
  })
  it('keeps non-ASCII characters in an Android marker filename', () => {
    expect(extractMediaFilename('Relatório Anual 2026.pdf (file attached)')).toBe('Relatório Anual 2026.pdf')
  })
  it('keeps non-Latin characters in an Android marker filename', () => {
    expect(extractMediaFilename('דוח שנתי.pdf (file attached)')).toBe('דוח שנתי.pdf')
  })
  it('keeps parentheses in an Android marker filename', () => {
    expect(extractMediaFilename('Invoice (final).pdf (file attached)')).toBe('Invoice (final).pdf')
  })
  it('extracts from a Portuguese "(arquivo anexado)" marker with spaces', () => {
    expect(extractMediaFilename('Relatório de Vendas.pdf (arquivo anexado)')).toBe('Relatório de Vendas.pdf')
  })
  it('extracts from a French "(fichier joint)" marker with spaces', () => {
    expect(extractMediaFilename('Compte Rendu Final.docx (fichier joint)')).toBe('Compte Rendu Final.docx')
  })
  it('extracts from a Spanish "(archivo adjunto)" marker with spaces', () => {
    expect(extractMediaFilename('Informe de Ventas.pdf (archivo adjunto)')).toBe('Informe de Ventas.pdf')
  })
  it('extracts a spaced filename when a caption follows on the next line', () => {
    expect(extractMediaFilename('Q1 Budget Review.pdf (file attached)\nthe numbers we discussed'))
      .toBe('Q1 Budget Review.pdf')
  })
  it('extracts a spaced filename from a marker prefixed by a bidi control mark', () => {
    expect(extractMediaFilename('‎Q1 Budget Review.pdf (file attached)')).toBe('Q1 Budget Review.pdf')
  })
  it('does not swallow a preceding caption line into the filename', () => {
    expect(extractMediaFilename('here it is\nQ1 Budget Review.pdf (file attached)'))
      .toBe('Q1 Budget Review.pdf')
  })
  it('keeps multiple dots in an Android marker filename', () => {
    expect(extractMediaFilename('report v1.2 final.pdf (file attached)')).toBe('report v1.2 final.pdf')
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

  // stripMediaMarker must remove exactly what extractMediaFilename captured;
  // if the two disagree about where a spaced filename starts, the leading words
  // of the filename survive as caption residue.
  it('strips a bare Android marker whose filename contains spaces', () => {
    expect(stripMediaMarker('Q1 Budget Review.pdf (file attached)')).toBe('')
  })
  it('leaves no filename residue in a caption following a spaced Android marker', () => {
    expect(stripMediaMarker('Q1 Budget Review.pdf (file attached)\nthe numbers we discussed'))
      .toBe('the numbers we discussed')
  })
  it('keeps a caption that precedes a spaced Android marker', () => {
    expect(stripMediaMarker('here it is\nQ1 Budget Review.pdf (file attached)')).toBe('here it is')
  })
  it('drops a spaced Android marker line sitting between two caption lines', () => {
    expect(stripMediaMarker('before\nTrip Photos 2026.zip (file attached)\nafter')).toBe('before\nafter')
  })
  it('strips an Android marker prefixed by the bidi mark WhatsApp inserts', () => {
    expect(stripMediaMarker('‎Q1 Budget Review.pdf (file attached)')).toBe('')
  })
  it('strips a bare Android marker whose filename is non-ASCII', () => {
    expect(stripMediaMarker('Relatório Anual 2026.pdf (file attached)')).toBe('')
  })
  it('strips a bare Android marker whose filename contains parentheses', () => {
    expect(stripMediaMarker('Invoice (final).pdf (file attached)')).toBe('')
  })
  it('strips a localized French marker with a spaced filename', () => {
    expect(stripMediaMarker('Compte Rendu Final.docx (fichier joint)\nvoilà')).toBe('voilà')
  })
  it('strips a localized Spanish marker with a spaced filename', () => {
    expect(stripMediaMarker('Informe de Ventas.pdf (archivo adjunto)\nbuenos días')).toBe('buenos días')
  })
  it('strips an iOS marker whose filename contains spaces', () => {
    expect(stripMediaMarker('<attached: Q1 Budget Review.pdf>\nthe numbers we discussed'))
      .toBe('the numbers we discussed')
  })
  it('leaves user text that merely mentions a file attached in prose intact', () => {
    expect(stripMediaMarker('I sent the file attached yesterday')).toBe('I sent the file attached yesterday')
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
