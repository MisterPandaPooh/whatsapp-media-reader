import { describe, it, expect } from 'vitest'
import { filteredMedia, threadWindow } from './selectors'
import { EMPTY_FILTERS, type Filters } from './useChatStore'
import type { MediaItem, Message } from '../types'

const media: MediaItem[] = [
  { id: 'm1', kind: 'photo', filename: 'a.jpg', size: 1, caption: 'sunset', sender: 'Ana', timestampMs: 100, anchorMessageId: 'msg1', starred: true, missing: false },
  { id: 'm2', kind: 'video', filename: 'b.mp4', size: 1, caption: 'clip', sender: 'Tomás', timestampMs: 200, anchorMessageId: 'msg2', starred: false, missing: false },
  { id: 'm3', kind: 'photo', filename: 'c.jpg', size: 1, caption: 'beach', sender: 'Ana', timestampMs: 300, anchorMessageId: 'msg3', starred: false, missing: false },
]

describe('filteredMedia', () => {
  it('returns all items when no filters are active', () => {
    expect(filteredMedia(media, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by type', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['video'] }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('filters by sender', () => {
    const f: Filters = { ...EMPTY_FILTERS, senders: ['Ana'] }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('filters by starred-only', () => {
    const f: Filters = { ...EMPTY_FILTERS, starredOnly: true }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m1'])
  })

  it('filters by free-text query against caption', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'beach' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3'])
  })

  it('filters by date range', () => {
    const f: Filters = { ...EMPTY_FILTERS, dateFrom: 150, dateTo: 250 }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('composes multiple filters with AND semantics', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['photo'], senders: ['Ana'], query: 'beach' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3'])
  })
})

describe('threadWindow', () => {
  const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
    id: `msg${i}`, sender: 'Ana', timestampMs: i, text: `line ${i}`, isSystemMessage: false,
  }))

  it('returns up to 50 messages before and after the anchor', () => {
    const w = threadWindow(messages, 'msg60')
    expect(w[0].id).toBe('msg10')
    expect(w[w.length - 1].id).toBe('msg110')
    expect(w).toHaveLength(101)
  })

  it('clamps at the start of the message list', () => {
    const w = threadWindow(messages, 'msg5')
    expect(w[0].id).toBe('msg0')
  })

  it('clamps at the end of the message list', () => {
    const w = threadWindow(messages, 'msg115')
    expect(w[w.length - 1].id).toBe('msg119')
  })

  it('returns an empty array for an unknown anchor id', () => {
    expect(threadWindow(messages, 'nope')).toEqual([])
  })
})
