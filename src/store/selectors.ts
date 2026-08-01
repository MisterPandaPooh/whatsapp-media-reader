// src/store/selectors.ts
import type { MediaItem, Message } from '../types'
import type { Filters } from './useChatStore'

/**
 * Filters the media index and returns it **newest-first** (spec, "Media grid").
 *
 * The ordering lives here rather than at import/hydration because this is the
 * single funnel every media *list* in the app goes through — the grid and the
 * detail panel's prev/next `filteredIds` are both derived from one call, so they
 * cannot disagree about what "next" means. Sorting `parsed.media` at import
 * instead would leave every chat already in IndexedDB oldest-first until it was
 * re-imported, and would silently reorder the array the anchor/`mediaById`
 * lookups and the summary counts read from.
 *
 * Ties (WhatsApp date formats without seconds collapse a whole minute onto one
 * timestamp) break on transcript position, descending: within a shared
 * timestamp the export's own order is the true chronology, so newest-first
 * reverses it. Being explicit rather than leaning on `Array#sort` stability
 * keeps the grid from reshuffling between renders.
 */
export function filteredMedia(media: MediaItem[], filters: Filters): MediaItem[] {
  const q = filters.query.trim().toLowerCase()
  const kept = media.filter((item) => {
    if (filters.types.length && !filters.types.includes(item.kind)) return false
    if (filters.senders.length && !filters.senders.includes(item.sender)) return false
    if (filters.starredOnly && !item.starred) return false
    // A quick-event selection replaces the single range rather than stacking
    // with it: both spell the same "when" filter, and combining them would mean
    // intersecting "every Pessah" with one calendar month, which is never what
    // picking an event from the list is asking for.
    if (filters.dateSpans.length) {
      if (!filters.dateSpans.some((s) => item.timestampMs >= s.from && item.timestampMs <= s.to)) {
        return false
      }
    } else {
      if (filters.dateFrom !== null && item.timestampMs < filters.dateFrom) return false
      if (filters.dateTo !== null && item.timestampMs > filters.dateTo) return false
    }
    if (q) {
      const haystack = `${item.caption} ${item.filename} ${item.sender}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  return kept
    .map((item, transcriptIndex) => ({ item, transcriptIndex }))
    .sort(
      (a, b) =>
        b.item.timestampMs - a.item.timestampMs || b.transcriptIndex - a.transcriptIndex,
    )
    .map((entry) => entry.item)
}

/** How many messages either side of the anchor the detail panel opens on. */
export const THREAD_RADIUS = 50
/** How many more it pulls in each time the reader scrolls off an edge. */
export const THREAD_CHUNK = 50

/** A half-open `[start, end)` slice of the chat's full `messages` array. */
export interface ThreadRange {
  start: number
  end: number
}

/**
 * The window the panel opens on: the anchor message plus `radius` either side.
 *
 * Returned as indices rather than the slice itself because the panel now grows
 * this window as the reader scrolls (see `extendThreadRange`), and growing it
 * has to be a cheap arithmetic step. The `findIndex` here scans the whole
 * parsed array — six figures long for a real export — so it must run once per
 * anchor, not once per extension and certainly not once per render.
 */
export function threadRange(
  messages: Message[],
  anchorId: string,
  radius = THREAD_RADIUS,
): ThreadRange {
  const index = messages.findIndex((m) => m.id === anchorId)
  if (index === -1) return { start: 0, end: 0 }
  return {
    start: Math.max(0, index - radius),
    end: Math.min(messages.length, index + radius + 1),
  }
}

/**
 * Grows the window by one chunk in the direction the reader is travelling.
 *
 * Only that direction: extending both ends would pull in messages nobody asked
 * for and double the prepend the scroll compensation has to cancel out.
 *
 * Returns the *identical* object when the chunk would be empty — the window
 * already reaches message 0 or the end of the chat. MessageThread treats a new
 * window array as "content moved, correct the scroll", so a fresh-but-equal
 * range at the ends would spin: scroll to top, extend by nothing, re-render,
 * scroll event, extend by nothing…
 */
export function extendThreadRange(
  range: ThreadRange,
  direction: 'before' | 'after',
  total: number,
  chunk = THREAD_CHUNK,
): ThreadRange {
  if (direction === 'before') {
    const start = Math.max(0, range.start - chunk)
    return start === range.start ? range : { start, end: range.end }
  }
  const end = Math.min(total, range.end + chunk)
  return end === range.end ? range : { start: range.start, end }
}

export function threadWindow(messages: Message[], anchorId: string, radius = THREAD_RADIUS): Message[] {
  const { start, end } = threadRange(messages, anchorId, radius)
  return messages.slice(start, end)
}
