// src/store/useChatStore.ts
import { create } from 'zustand'
import { setStarred } from '../storage/chatRepository'
import type { MediaKind, StoredChat } from '../types'

/** An inclusive span of epoch-ms. */
export interface DateSpan {
  from: number
  to: number
}

export interface Filters {
  types: MediaKind[]
  senders: string[]
  dateFrom: number | null
  dateTo: number | null
  /**
   * A set of disjoint spans, for a quick-event selection like "every Pessah":
   * seven separate weeks across seven years cannot be written as one
   * `dateFrom`/`dateTo` range. Non-empty means it *replaces* that range rather
   * than narrowing it further — the two are alternative spellings of the same
   * date filter, and the toolbar clears one whenever it sets the other.
   */
  dateSpans: DateSpan[]
  query: string
  starredOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  types: [],
  senders: [],
  dateFrom: null,
  dateTo: null,
  dateSpans: [],
  query: '',
  starredOnly: false,
}

interface ChatState {
  chat: StoredChat | null
  filters: Filters
  activeMediaId: string | null
  setChat: (chat: StoredChat | null) => void
  setFilters: (patch: Partial<Filters>) => void
  resetFilters: () => void
  openMedia: (id: string) => void
  closePanel: () => void
  toggleStarred: (mediaId: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  chat: null,
  filters: EMPTY_FILTERS,
  activeMediaId: null,
  // A different chat invalidates both the selection and the filters: an
  // activeMediaId or sender filter from the previous import means nothing here.
  setChat: (chat) => set({ chat, activeMediaId: null, filters: EMPTY_FILTERS }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  openMedia: (id) => set({ activeMediaId: id }),
  closePanel: () => set({ activeMediaId: null }),
  toggleStarred: (mediaId) => {
    set((s) => {
      if (!s.chat) return s
      const next = !s.chat.starred[mediaId]
      const media = s.chat.parsed.media.map((m) => (m.id === mediaId ? { ...m, starred: next } : m))
      return {
        chat: {
          ...s.chat,
          starred: { ...s.chat.starred, [mediaId]: next },
          parsed: { ...s.chat.parsed, media },
        },
      }
    })
    // Read state AFTER the set() has applied, so we persist the new value.
    const chat = get().chat
    const nowStarred = chat?.starred[mediaId]
    // Fire-and-forget: the UI must not block on IndexedDB.
    if (chat && nowStarred !== undefined) void setStarred(chat.chatId, mediaId, nowStarred)
  },
}))
