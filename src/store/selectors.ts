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
    if (filters.dateFrom !== null && item.timestampMs < filters.dateFrom) return false
    if (filters.dateTo !== null && item.timestampMs > filters.dateTo) return false
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

export function threadWindow(messages: Message[], anchorId: string, radius = 50): Message[] {
  const index = messages.findIndex((m) => m.id === anchorId)
  if (index === -1) return []
  const start = Math.max(0, index - radius)
  const end = Math.min(messages.length, index + radius + 1)
  return messages.slice(start, end)
}
