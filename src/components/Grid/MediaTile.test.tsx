// src/components/Grid/MediaTile.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MediaTile } from './MediaTile'
import { useChatStore } from '../../store/useChatStore'
import type { MediaItem, StorageRef } from '../../types'

const storageRef: StorageRef = { kind: 'opfs', folder: 'test-chat' }

function makeItem(patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm1',
    kind: 'doc',
    filename: 'report.pdf',
    size: 10,
    caption: 'Quarterly report',
    sender: 'Alice',
    timestampMs: 1700000000000,
    anchorMessageId: 'msg1',
    starred: false,
    // `missing` keeps the tile off the thumbnail path, which needs an
    // IntersectionObserver jsdom does not implement.
    missing: true,
    ...patch,
  }
}

function renderTile(item: MediaItem, onOpen = vi.fn()) {
  useChatStore.setState({
    chat: {
      chatId: 'chat-1',
      title: 'Test chat',
      importedAtMs: 0,
      storageRef,
      meParticipant: null,
      parsed: { messages: [], media: [item], participants: ['Alice'] },
      starred: item.starred ? { [item.id]: true } : {},
    },
  })
  render(<MediaTile item={item} storageRef={storageRef} selected={false} onOpen={onOpen} scrollRoot={null} />)
  return { onOpen }
}

const starButton = () => screen.getByRole('button', { name: /star/i })
const openControl = () => screen.getByRole('button', { name: 'Quarterly report' })

beforeEach(() => {
  useChatStore.setState({ chat: null, activeMediaId: null })
})

afterEach(() => {
  cleanup()
})

describe('MediaTile star toggle', () => {
  it('toggles starred on click without opening the tile', () => {
    const { onOpen } = renderTile(makeItem())

    fireEvent.click(starButton())

    expect(useChatStore.getState().chat?.starred['m1']).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' '] as const)(
    'lets the star button handle a %s keypress natively instead of opening the tile',
    (key) => {
      const { onOpen } = renderTile(makeItem())
      const star = starButton()
      star.focus()

      const down = fireEvent.keyDown(star, { key })
      fireEvent.keyUp(star, { key })

      // The tile must not hijack a keypress aimed at the star: swallowing it
      // opens the panel AND cancels the button's native activation.
      expect(onOpen).not.toHaveBeenCalled()
      expect(down).toBe(true) // i.e. preventDefault() was not called
    },
  )

  it('is a sibling of the open control, not nested inside it', () => {
    renderTile(makeItem())

    // Nested interactive elements are invalid HTML, and role="button" is
    // "children presentational", so a nested star has no accessible role.
    expect(openControl().contains(starButton())).toBe(false)
  })

  it('exposes the open control as a real button so Enter/Space activate it', () => {
    renderTile(makeItem())

    expect(openControl().tagName).toBe('BUTTON')
  })

  it('opens the tile on click', () => {
    const { onOpen } = renderTile(makeItem())

    fireEvent.click(openControl())

    expect(onOpen).toHaveBeenCalledWith('m1')
  })

  it('reflects the starred state on the button', () => {
    renderTile(makeItem({ starred: true }))

    expect(starButton().getAttribute('aria-pressed')).toBe('true')
    expect(starButton().className).toContain('tile-star--on')
  })
})

describe('MediaTile content', () => {
  it('renders a placeholder instead of media for missing files', () => {
    renderTile(makeItem({ kind: 'photo', filename: 'IMG-1.jpg', missing: true }))

    expect(document.querySelector('.tile-missing')).not.toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders a type badge card for documents', () => {
    renderTile(makeItem({ missing: false }))

    expect(document.querySelector('.tile-file')).not.toBeNull()
    expect(screen.getByText('PDF')).not.toBeNull()
  })

  it('labels voice and link cards by kind when the filename has no extension', () => {
    renderTile(makeItem({ kind: 'link', filename: '', missing: false }))

    expect(screen.getByText('LINK')).not.toBeNull()
  })
})

describe('MediaTile double-click', () => {
  it('opens the fullscreen gallery for the tile that was double-clicked', () => {
    const item = makeItem()
    const onOpen = vi.fn()
    const onOpenFullscreen = vi.fn()
    useChatStore.setState({
      chat: {
        chatId: 'chat-1',
        title: 'Test chat',
        importedAtMs: 0,
        storageRef,
        meParticipant: null,
        parsed: { messages: [], media: [item], participants: ['Alice'] },
        starred: {},
      },
    })
    render(
      <MediaTile
        item={item}
        storageRef={storageRef}
        selected={false}
        onOpen={onOpen}
        onOpenFullscreen={onOpenFullscreen}
        scrollRoot={null}
      />,
    )
    fireEvent.doubleClick(document.querySelector('.tile-open')!)

    expect(onOpenFullscreen).toHaveBeenCalledWith('m1')
  })

  it('is inert when no fullscreen handler is given', () => {
    const onOpen = vi.fn()
    renderTile(makeItem(), onOpen)
    // Single click still selects; the second one simply selects again.
    fireEvent.doubleClick(document.querySelector('.tile-open')!)

    expect(document.querySelector('.tile-open')).not.toBeNull()
  })
})
