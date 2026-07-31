// src/components/Panel/DetailPanel.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MediaItem, Message, StorageRef } from '../../types'

// The thread needs layout jsdom does not provide, and none of these tests care
// what it renders — only how the panel shell handles Escape.
vi.mock('./MessageThread', () => ({
  MessageThread: () => null,
}))
vi.mock('../../storage/fileAccess', () => ({
  readMediaFile: () => Promise.resolve(null),
}))

const closePanel = vi.fn()
vi.mock('../../store/useChatStore', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ openMedia: vi.fn(), closePanel, toggleStarred: vi.fn(), chat: null }),
}))

const { DetailPanel } = await import('./DetailPanel')

const item: MediaItem = {
  id: 'm1',
  kind: 'doc',
  filename: 'invoice.pdf',
  size: 1024,
  caption: 'the invoice',
  sender: 'Ana',
  timestampMs: Date.UTC(2025, 8, 3, 10, 0),
  anchorMessageId: 'msg1',
  starred: false,
  missing: false,
}

const messages: Message[] = [
  { id: 'msg1', sender: 'Ana', timestampMs: item.timestampMs, text: 'here it is', isSystemMessage: false },
]

const storageRef: StorageRef = { kind: 'opfs', folder: 'chat-1' }

function renderPanel() {
  return render(
    <DetailPanel
      activeItem={item}
      messages={messages}
      filteredIds={['m1']}
      meParticipant={null}
      storageRef={storageRef}
    />,
  )
}

afterEach(() => {
  cleanup()
  closePanel.mockClear()
})

describe('DetailPanel Escape handling', () => {
  it('closes the panel on Escape', () => {
    renderPanel()
    fireEvent.keyDown(screen.getByRole('button', { name: /close/i }), { key: 'Escape' })
    expect(closePanel).toHaveBeenCalledTimes(1)
  })

  // The Toolbar dismisses its popovers from a capture-phase window listener, so
  // it runs BEFORE this handler and marks the event with preventDefault(). If
  // the panel ignored that, one Escape with a popover open would dismiss the
  // popover *and* close the panel — the bug this test pins down. Registering a
  // real capture listener reproduces the actual interaction rather than trying
  // to fake `defaultPrevented`, which is a read-only getter.
  it('leaves the panel open when the keypress was already consumed', () => {
    renderPanel()
    const consume = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    window.addEventListener('keydown', consume, true)
    try {
      fireEvent.keyDown(screen.getByRole('button', { name: /close/i }), { key: 'Escape' })
    } finally {
      window.removeEventListener('keydown', consume, true)
    }
    expect(closePanel).not.toHaveBeenCalled()
  })

  it('ignores keys other than Escape', () => {
    renderPanel()
    fireEvent.keyDown(screen.getByRole('button', { name: /close/i }), { key: 'Enter' })
    expect(closePanel).not.toHaveBeenCalled()
  })
})
