import { describe, it, expect } from 'vitest'
import { extendThreadRange, facetMedia, filteredMedia, threadRange, threadWindow } from './selectors'
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

describe('threadRange', () => {
  const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
    id: `msg${i}`, sender: 'Ana', timestampMs: i, text: `line ${i}`, isSystemMessage: false,
  }))

  it('centres a ±50 window on the anchor', () => {
    expect(threadRange(messages, 'msg60')).toEqual({ start: 10, end: 111 })
  })

  it('clamps at the start of the message list', () => {
    expect(threadRange(messages, 'msg5')).toEqual({ start: 0, end: 56 })
  })

  it('clamps at the end of the message list', () => {
    expect(threadRange(messages, 'msg115')).toEqual({ start: 65, end: 120 })
  })

  it('returns an empty range for an unknown anchor id', () => {
    expect(threadRange(messages, 'nope')).toEqual({ start: 0, end: 0 })
  })

  it('agrees with threadWindow, which is the same slice', () => {
    const r = threadRange(messages, 'msg60')
    expect(messages.slice(r.start, r.end)).toEqual(threadWindow(messages, 'msg60'))
  })
})

describe('extendThreadRange', () => {
  // The window only ever grows, and only in the direction the reader is going —
  // extending both ends at once would double the work and pull the far edge of
  // the conversation in for no reason.
  it('extends backwards by one chunk without moving the far edge', () => {
    expect(extendThreadRange({ start: 200, end: 301 }, 'before', 500)).toEqual({
      start: 150,
      end: 301,
    })
  })

  it('extends forwards by one chunk without moving the near edge', () => {
    expect(extendThreadRange({ start: 200, end: 301 }, 'after', 500)).toEqual({
      start: 200,
      end: 351,
    })
  })

  it('clamps a backwards extension at the first message', () => {
    expect(extendThreadRange({ start: 20, end: 121 }, 'before', 500)).toEqual({
      start: 0,
      end: 121,
    })
  })

  it('clamps a forwards extension at the last message', () => {
    expect(extendThreadRange({ start: 380, end: 481 }, 'after', 500)).toEqual({
      start: 380,
      end: 500,
    })
  })

  // Identity, not just equality: MessageThread's scroll compensation and the
  // re-centre guard both key off the window array changing. A no-op extension
  // at message 0 that still produced a fresh object would re-render the thread
  // forever — scroll to top, expand by nothing, scroll event, expand again.
  it('returns the very same object when there is nothing left to add', () => {
    const atStart = { start: 0, end: 101 }
    expect(extendThreadRange(atStart, 'before', 500)).toBe(atStart)
    const atEnd = { start: 399, end: 500 }
    expect(extendThreadRange(atEnd, 'after', 500)).toBe(atEnd)
  })

  it('honours a custom chunk size', () => {
    expect(extendThreadRange({ start: 200, end: 301 }, 'before', 500, 10)).toEqual({
      start: 190,
      end: 301,
    })
  })
})

describe('facetMedia', () => {
  const day = (n: number) => Date.UTC(2026, 4, n)
  const at = (
    id: string,
    kind: MediaItem['kind'],
    sender: string,
    dayN: number,
    starred = false,
  ): MediaItem => ({
    id, kind, filename: `${id}.bin`, size: 1, caption: '', sender,
    timestampMs: day(dayN), anchorMessageId: id, starred, missing: false,
  })

  const set: MediaItem[] = [
    at('a', 'photo', 'Nina', 1, true),
    at('b', 'photo', 'Amit', 1),
    at('c', 'video', 'Nina', 1),
    at('d', 'video', 'Amit', 9),
    at('e', 'doc', 'Nina', 9),
  ]
  const ids = (list: MediaItem[]) => list.map((m) => m.id).sort()

  it('ignores the type filter when counting types, so the other chips stay useful', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['photo'] }
    // The grid shows only photos...
    expect(ids(filteredMedia(set, f))).toEqual(['a', 'b'])
    // ...but the chips still say what picking Videos instead would give.
    expect(ids(facetMedia(set, f, 'type'))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('still applies every other filter while ignoring its own', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['photo'], senders: ['Nina'] }
    expect(ids(facetMedia(set, f, 'type'))).toEqual(['a', 'c', 'e'])
    expect(ids(facetMedia(set, f, 'sender'))).toEqual(['a', 'b'])
  })

  it('clears both spellings of the date filter together', () => {
    const spans: Filters = { ...EMPTY_FILTERS, dateSpans: [{ from: day(9), to: day(9) + 86_399_999 }] }
    expect(ids(filteredMedia(set, spans))).toEqual(['d', 'e'])
    expect(ids(facetMedia(set, spans, 'date'))).toEqual(['a', 'b', 'c', 'd', 'e'])

    const range: Filters = { ...EMPTY_FILTERS, dateFrom: day(9), dateTo: day(9) + 86_399_999 }
    expect(ids(facetMedia(set, range, 'date'))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('counts what starring would keep, not what it currently keeps', () => {
    const f: Filters = { ...EMPTY_FILTERS, starredOnly: true }
    expect(ids(filteredMedia(set, f))).toEqual(['a'])
    expect(ids(facetMedia(set, f, 'starred'))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps honouring the search box, which has no facet of its own', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'Nina', types: ['photo'] }
    expect(ids(facetMedia(set, f, 'type'))).toEqual(['a', 'c', 'e'])
  })
})
