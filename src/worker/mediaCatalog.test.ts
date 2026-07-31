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
})
