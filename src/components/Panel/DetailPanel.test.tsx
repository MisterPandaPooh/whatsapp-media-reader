// src/components/Panel/DetailPanel.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MediaItem, Message, StorageRef } from '../../types'

// The thread needs layout jsdom does not provide, and none of these tests care
// what it renders — only how the panel shell handles Escape, and which window
// of messages it hands down.
interface ThreadProps {
  messages: Message[]
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  onExtendBefore?: () => void
  onExtendAfter?: () => void
}
const threadRenders: ThreadProps[] = []
vi.mock('./MessageThread', () => ({
  MessageThread: (props: ThreadProps) => {
    threadRenders.push(props)
    return null
  },
}))
const lastThread = () => threadRenders[threadRenders.length - 1]
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
      allMedia={[item]}
      filteredIds={['m1']}
      meParticipant={null}
      storageRef={storageRef}
    />,
  )
}

afterEach(() => {
  cleanup()
  closePanel.mockClear()
  threadRenders.length = 0
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

describe('DetailPanel thread window', () => {
  const chat: Message[] = Array.from({ length: 400 }, (_, i) => ({
    id: `msg${i}`,
    sender: 'Ana',
    timestampMs: Date.UTC(2025, 8, 3, 10, 0) + i * 60_000,
    text: `line ${i}`,
    isSystemMessage: false,
  }))
  const at = (i: number): MediaItem => ({ ...item, id: `media${i}`, anchorMessageId: `msg${i}` })

  function renderAt(i: number) {
    return render(
      <DetailPanel
        activeItem={at(i)}
        messages={chat}
        allMedia={[at(i)]}
        filteredIds={[`media${i}`]}
        meParticipant={null}
        storageRef={storageRef}
      />,
    )
  }

  const ids = () => lastThread().messages.map((m) => m.id)

  it('opens on a ±50 window centred on the anchor', () => {
    renderAt(200)
    expect(ids()).toHaveLength(101)
    expect(ids()[0]).toBe('msg150')
    expect(ids()[100]).toBe('msg250')
    expect(lastThread().hasMoreBefore).toBe(true)
    expect(lastThread().hasMoreAfter).toBe(true)
  })

  it('grows backwards a chunk at a time, leaving the far edge alone', () => {
    renderAt(200)
    act(() => lastThread().onExtendBefore!())
    expect(ids()[0]).toBe('msg100')
    expect(ids()[ids().length - 1]).toBe('msg250')

    act(() => lastThread().onExtendBefore!())
    expect(ids()[0]).toBe('msg50')
    expect(ids()).toHaveLength(201)
  })

  it('grows forwards and reports when it has reached the last message', () => {
    renderAt(200)
    for (let i = 0; i < 3; i++) act(() => lastThread().onExtendAfter!())
    expect(ids()[ids().length - 1]).toBe('msg399')
    expect(lastThread().hasMoreAfter).toBe(false)
    expect(lastThread().hasMoreBefore).toBe(true)
  })

  it('reports when it has reached the first message', () => {
    renderAt(60)
    act(() => lastThread().onExtendBefore!())
    expect(ids()[0]).toBe('msg0')
    expect(lastThread().hasMoreBefore).toBe(false)
  })

  // Otherwise the window ratchets open across a whole browsing session and the
  // panel's "centred on the item you clicked" promise quietly stops meaning
  // anything — by the tenth prev/next you would be opening onto 600 messages.
  it('resets the window when stepping to another item', () => {
    const { rerender } = renderAt(200)
    act(() => lastThread().onExtendBefore!())
    act(() => lastThread().onExtendBefore!())
    expect(ids()).toHaveLength(201)

    rerender(
      <DetailPanel
        activeItem={at(300)}
        messages={chat}
        allMedia={[at(300)]}
        filteredIds={['media300']}
        meParticipant={null}
        storageRef={storageRef}
      />,
    )
    expect(ids()).toHaveLength(101)
    expect(ids()[0]).toBe('msg250')
  })

  it('does not rescan the whole chat when an unrelated prop changes', () => {
    const { rerender } = renderAt(200)
    act(() => lastThread().onExtendBefore!())
    const before = lastThread().messages

    rerender(
      <DetailPanel
        activeItem={at(200)}
        messages={chat}
        allMedia={[at(200)]}
        filteredIds={['media200', 'other']}
        meParticipant="Ana"
        storageRef={storageRef}
      />,
    )
    // Same array identity: the window survived, and nothing re-sliced.
    expect(lastThread().messages).toBe(before)
  })
})
