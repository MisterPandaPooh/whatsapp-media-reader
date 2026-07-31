import { describe, it, expect } from 'vitest'
import { reconcileMediaWithFiles } from './mediaCatalog'
import type { MediaItem } from '../types'

function item(filename: string): MediaItem {
  return {
    id: `${filename}-media`, kind: 'photo', filename, size: 0, caption: '',
    sender: 'Ana', timestampMs: 0, anchorMessageId: 'm1', starred: false, missing: false,
  }
}

describe('reconcileMediaWithFiles', () => {
  it('marks items present in the file list as not missing, with real size', () => {
    const [result] = reconcileMediaWithFiles([item('a.jpg')], new Map([['a.jpg', 1234]]))
    expect(result.missing).toBe(false)
    expect(result.size).toBe(1234)
  })

  it('marks items absent from the file list as missing', () => {
    const [result] = reconcileMediaWithFiles([item('gone.jpg')], new Map())
    expect(result.missing).toBe(true)
  })

  it('link items are never marked missing regardless of file list', () => {
    const link: MediaItem = { ...item('https://example.com'), kind: 'link' }
    const [result] = reconcileMediaWithFiles([link], new Map())
    expect(result.missing).toBe(false)
  })

  it('matches a filename containing spaces', () => {
    const [result] = reconcileMediaWithFiles(
      [item('Q1 Budget Review.pdf')],
      new Map([['Q1 Budget Review.pdf', 4096]]),
    )
    expect(result.missing).toBe(false)
    expect(result.size).toBe(4096)
  })

  it('matches a filename containing non-ASCII characters and spaces', () => {
    const [result] = reconcileMediaWithFiles(
      [item('Relatório Anual 2026.pdf')],
      new Map([['Relatório Anual 2026.pdf', 77]]),
    )
    expect(result.missing).toBe(false)
    expect(result.size).toBe(77)
  })

  // Regression sentinel for the parser truncating spaced filenames at the last
  // whitespace: the file is on disk, but the truncated name matches nothing.
  it('marks a truncated spaced filename as missing against the real catalog', () => {
    const [result] = reconcileMediaWithFiles(
      [item('Review.pdf')],
      new Map([['Q1 Budget Review.pdf', 4096]]),
    )
    expect(result.missing).toBe(true)
  })

  it('matches a filename containing parentheses', () => {
    const [result] = reconcileMediaWithFiles(
      [item('Invoice (final).pdf')],
      new Map([['Invoice (final).pdf', 12]]),
    )
    expect(result.missing).toBe(false)
  })

  it('reconciles every item in a mixed batch independently', () => {
    const results = reconcileMediaWithFiles(
      [item('Q1 Budget Review.pdf'), item('gone.jpg'), item('a.jpg')],
      new Map([['Q1 Budget Review.pdf', 10], ['a.jpg', 20]]),
    )
    expect(results.map((r) => r.missing)).toEqual([false, true, false])
  })
})
