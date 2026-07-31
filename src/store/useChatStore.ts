// src/store/useChatStore.ts
import { create } from 'zustand'
import type { MediaKind, StoredChat } from '../types'

export interface Filters {
  types: MediaKind[]
  senders: string[]
  dateFrom: number | null
  dateTo: number | null
  query: string
  starredOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  types: [],
  senders: [],
  dateFrom: null,
  dateTo: null,
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

export const useChatStore = create<ChatState>((set) => ({
  chat: null,
  filters: EMPTY_FILTERS,
  activeMediaId: null,
  setChat: (chat) => set({ chat }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  openMedia: (id) => set({ activeMediaId: id }),
  closePanel: () => set({ activeMediaId: null }),
  toggleStarred: (mediaId) =>
    set((s) => {
      if (!s.chat) return s
      const next = !s.chat.starred[mediaId]
      return { chat: { ...s.chat, starred: { ...s.chat.starred, [mediaId]: next } } }
    }),
}))
