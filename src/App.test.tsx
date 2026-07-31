// src/App.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StoredChat } from './types'

// Swappable per test so the startup restore can be made to resolve, reject or —
// the case that produced a permanently blank screen in a real browser — never
// settle at all.
const repo = vi.hoisted(() => ({
  loadLastChat: (): Promise<StoredChat | null> => Promise.resolve(null),
}))
vi.mock('./storage/chatRepository', () => ({
  loadLastChat: () => repo.loadLastChat(),
  deleteChat: vi.fn(() => Promise.resolve()),
  saveChat: vi.fn(() => Promise.resolve()),
  setStarred: vi.fn(() => Promise.resolve()),
}))

// `SUPPORTED` is evaluated when App.tsx is first imported, so both capabilities
// have to exist before that import — hence the dynamic import below.
vi.stubGlobal('showDirectoryPicker', vi.fn())
Object.defineProperty(navigator, 'storage', {
  configurable: true,
  value: { getDirectory: vi.fn(async () => ({})) },
})
// jsdom implements neither; the grid observes its own size, tiles observe visibility.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const { default: App } = await import('./App')
const { useChatStore, EMPTY_FILTERS } = await import('./store/useChatStore')

function makeChat(patch: Partial<StoredChat> = {}): StoredChat {
  return {
    chatId: 'chat-1',
    title: 'Family Trip',
    importedAtMs: 0,
    storageRef: { kind: 'opfs', folder: 'chat-1' },
    meParticipant: null,
    parsed: {
      messages: [
        { id: 'msg1', sender: 'Alice', timestampMs: 1700000000000, text: 'hi', isSystemMessage: false },
      ],
      media: [
        {
          id: 'm1',
          kind: 'doc',
          filename: 'report.pdf',
          size: 10,
          caption: 'Quarterly report',
          sender: 'Alice',
          timestampMs: 1700000000000,
          anchorMessageId: 'msg1',
          starred: false,
          missing: true,
        },
      ],
      participants: ['Alice', 'Bob'],
    },
    starred: {},
    ...patch,
  }
}

beforeEach(() => {
  useChatStore.setState({ chat: makeChat(), activeMediaId: null })
  repo.loadLastChat = () => Promise.resolve(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const importButton = () => screen.getByRole('button', { name: 'Import chat…' })
const dropZone = () => screen.queryByText('Drop your chat export here')

describe('App header', () => {
  it('names the loaded chat and summarizes it', async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Family Trip' })).toBeTruthy())
    // Message count and participant count, in the metadata line.
    expect(screen.getByText(/1 message · .* · 2 people/)).toBeTruthy()
  })

  it('opens the import screen over the reader', async () => {
    render(<App />)
    await waitFor(() => expect(importButton()).toBeTruthy())

    fireEvent.click(importButton())

    expect(dropZone()).toBeTruthy()
    // The reader is still mounted underneath — that is what makes cancelling free.
    expect(screen.getByRole('heading', { name: 'Family Trip' })).toBeTruthy()
    // …but Tab must not walk into it while the overlay covers it.
    expect(document.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true)
  })

  it('hands the reader back its interactivity on cancel', async () => {
    render(<App />)
    await waitFor(() => expect(importButton()).toBeTruthy())
    fireEvent.click(importButton())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(document.querySelector('.app-shell')?.hasAttribute('inert')).toBe(false)
  })

  it('returns to the loaded chat on cancel, without touching it', async () => {
    render(<App />)
    await waitFor(() => expect(importButton()).toBeTruthy())
    fireEvent.click(importButton())

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(dropZone()).toBeNull()
    expect(screen.getByRole('heading', { name: 'Family Trip' })).toBeTruthy()
    expect(useChatStore.getState().chat?.chatId).toBe('chat-1')
  })
})

describe('App startup when IndexedDB hangs', () => {
  /** A promise that never settles — what a blocked `open()` actually looks like. */
  function neverSettles(): Promise<StoredChat | null> {
    return new Promise<StoredChat | null>(() => {})
  }

  it('falls through to the import screen instead of a permanently blank page', async () => {
    vi.useFakeTimers()
    useChatStore.setState({ chat: null, activeMediaId: null })
    repo.loadLastChat = neverSettles

    render(<App />)
    // Still gated: this is the correct behaviour for the first few seconds.
    expect(dropZone()).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(dropZone()).toBeTruthy()
  })

  it('says why the import screen is showing rather than failing silently', async () => {
    vi.useFakeTimers()
    useChatStore.setState({ chat: null, activeMediaId: null })
    repo.loadLastChat = neverSettles

    render(<App />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(screen.getByRole('status').textContent).toMatch(/could not be loaded/i)
  })

  it('ignores a restore that finally arrives after the timeout', async () => {
    vi.useFakeTimers()
    useChatStore.setState({ chat: null, activeMediaId: null })
    let resolveLoad!: (chat: StoredChat | null) => void
    repo.loadLastChat = () =>
      new Promise<StoredChat | null>((resolve) => {
        resolveLoad = resolve
      })

    render(<App />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(dropZone()).toBeTruthy()

    // The unblocked read lands minutes later, by which time the user is part way
    // through importing something else. It must not yank them out of that.
    await act(async () => {
      resolveLoad(makeChat())
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(dropZone()).toBeTruthy()
    expect(useChatStore.getState().chat).toBeNull()
  })

  it('does not time out a restore that simply takes a while', async () => {
    vi.useFakeTimers()
    useChatStore.setState({ chat: null, activeMediaId: null })
    repo.loadLastChat = () =>
      new Promise<StoredChat | null>((resolve) => setTimeout(() => resolve(null), 3_000))

    render(<App />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(dropZone()).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('Escape with the import overlay open', () => {
  it('cancels the import without closing the detail panel behind it', async () => {
    useChatStore.setState({ chat: makeChat(), activeMediaId: 'm1' })
    render(<App />)
    await waitFor(() => expect(importButton()).toBeTruthy())
    expect(screen.getByRole('complementary', { name: 'Message detail' })).toBeTruthy()

    fireEvent.click(importButton())
    fireEvent.keyDown(window, { key: 'Escape' })

    // `inert` on the shell stops clicks and Tab but not window-level key
    // listeners, so the app's Escape handler used to close the panel hidden
    // underneath the overlay.
    expect(dropZone()).toBeNull()
    expect(useChatStore.getState().activeMediaId).toBe('m1')
    expect(screen.getByRole('complementary', { name: 'Message detail' })).toBeTruthy()
  })

  it('leaves the first-run import screen alone, having nothing to cancel back to', async () => {
    useChatStore.setState({ chat: null, activeMediaId: null })
    render(<App />)
    await waitFor(() => expect(dropZone()).toBeTruthy())

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(dropZone()).toBeTruthy()
  })
})

describe('the open item falling outside the filters', () => {
  /** Two items so a type filter can exclude the open one while leaving a result set. */
  function twoItemChat(): StoredChat {
    const base = makeChat()
    return {
      ...base,
      parsed: {
        ...base.parsed,
        messages: [
          ...base.parsed.messages,
          { id: 'msg2', sender: 'Bob', timestampMs: 1700000100000, text: 'clip', isSystemMessage: false },
        ],
        media: [
          base.parsed.media[0],
          {
            id: 'm2',
            kind: 'video' as const,
            filename: 'clip.mp4',
            size: 20,
            caption: 'the clip',
            sender: 'Bob',
            timestampMs: 1700000100000,
            anchorMessageId: 'msg2',
            starred: false,
            missing: true,
          },
        ],
      },
    }
  }

  const panel = () => screen.queryByRole('complementary', { name: 'Message detail' })

  it('keeps the panel open on the still-selected item', async () => {
    // Narrowing the filters while the panel is open used to make it vanish with
    // no explanation — and reappear when the filter was relaxed, because
    // activeMediaId was never cleared. The selection is the user's, not the
    // filter's: the panel stays, and says the item is outside the results.
    useChatStore.setState({ chat: twoItemChat(), activeMediaId: 'm1', filters: EMPTY_FILTERS })
    render(<App />)
    await waitFor(() => expect(panel()).toBeTruthy())

    act(() => {
      useChatStore.getState().setFilters({ types: ['video'] })
    })

    expect(panel()).toBeTruthy()
    expect(document.querySelector('.panel-position')?.textContent).toBe('— of 1')
  })

  it('lets Next drop back into the filtered set', async () => {
    useChatStore.setState({ chat: twoItemChat(), activeMediaId: 'm1', filters: EMPTY_FILTERS })
    render(<App />)
    await waitFor(() => expect(panel()).toBeTruthy())
    act(() => {
      useChatStore.getState().setFilters({ types: ['video'] })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))

    expect(useChatStore.getState().activeMediaId).toBe('m2')
    expect(document.querySelector('.panel-position')?.textContent).toBe('1 of 1')
  })
})
