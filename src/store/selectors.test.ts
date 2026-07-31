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
    // Newest-first, per the spec's media grid ordering — m3 (t=300) precedes m1 (t=100).
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3', 'm1'])
  })

  it('filters by starred-only', () => {
    const f: Filters = { ...EMPTY_FILTERS, starredOnly: true }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m1'])
  })

  it('filters by free-text query against caption', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'beach' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3'])
  })

  it('filters by free-text query against filename', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'b.mp4' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('filters by free-text query against sender name', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'Tomás' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('matches the query case-insensitively', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'BEACH' }
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

describe('filteredMedia ordering', () => {
  // Spec, "Media grid": square tiles, newest-first by default. The parser emits
  // media in chat (oldest-first) order, so the ordering has to be applied here —
  // this is the one funnel both the grid and the panel's prev/next list run through.
  it('returns media newest-first', () => {
    expect(filteredMedia(media, EMPTY_FILTERS).map((m) => m.id)).toEqual(['m3', 'm2', 'm1'])
  })

  it('keeps a filtered subset newest-first too', () => {
    const f: Filters = { ...EMPTY_FILTERS, senders: ['Ana'] }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3', 'm1'])
  })

  it('does not mutate the input array', () => {
    const input = [...media]
    filteredMedia(input, EMPTY_FILTERS)
    expect(input.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('orders items sharing a timestamp deterministically, later-in-transcript first', () => {
    // Exports whose date format has no seconds collapse a whole minute onto one
    // timestamp. Transcript order is the real chronology inside that minute, so
    // newest-first means reversing it — and the tie-break must be explicit so the
    // grid cannot reshuffle between renders.
    const sameMinute: MediaItem[] = [
      { ...media[0], id: 'a', timestampMs: 500 },
      { ...media[0], id: 'b', timestampMs: 500 },
      { ...media[0], id: 'c', timestampMs: 500 },
    ]
    expect(filteredMedia(sameMinute, EMPTY_FILTERS).map((m) => m.id)).toEqual(['c', 'b', 'a'])
    // Same input, same output — twice, from two separate calls.
    expect(filteredMedia(sameMinute, EMPTY_FILTERS).map((m) => m.id)).toEqual(
      filteredMedia(sameMinute, EMPTY_FILTERS).map((m) => m.id),
    )
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
