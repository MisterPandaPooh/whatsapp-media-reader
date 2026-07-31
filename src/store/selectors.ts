// src/store/selectors.ts
import type { MediaItem, Message } from '../types'
import type { Filters } from './useChatStore'

export function filteredMedia(media: MediaItem[], filters: Filters): MediaItem[] {
  const q = filters.query.trim().toLowerCase()
  return media.filter((item) => {
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
}

export function threadWindow(messages: Message[], anchorId: string, radius = 50): Message[] {
  const index = messages.findIndex((m) => m.id === anchorId)
  if (index === -1) return []
  const start = Math.max(0, index - radius)
  const end = Math.min(messages.length, index + radius + 1)
  return messages.slice(start, end)
}
