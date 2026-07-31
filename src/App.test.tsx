// src/App.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { StoredChat } from './types'

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
const { useChatStore } = await import('./store/useChatStore')

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
})

afterEach(() => {
  cleanup()
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
