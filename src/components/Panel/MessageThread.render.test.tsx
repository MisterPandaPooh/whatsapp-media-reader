// src/components/Panel/MessageThread.render.test.tsx
//
// Sibling of MessageThread.test.tsx, which stubs the virtualizer down to *zero*
// rendered rows because it only cares about scroll calls. These tests need the
// rows to actually exist, so they use a stub that emits one virtual item per
// message — hence a separate file, since vi.mock is per-module-graph.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { MediaItem, Message } from '../../types'
import { parseChat } from '../../parser/chatParser'

let itemCount = 0
const virtualizerStub = {
  scrollToIndex: vi.fn(),
  getTotalSize: () => itemCount * 56,
  getVirtualItems: () =>
    Array.from({ length: itemCount }, (_, i) => ({ index: i, key: i, start: i * 56 })),
  measureElement: () => {},
}
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    itemCount = opts.count
    return virtualizerStub
  },
}))

const { MessageThread } = await import('./MessageThread')

function mediaItem(patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media1',
    kind: 'photo',
    filename: 'IMG-20250300-WA0002.png',
    size: 0,
    caption: '',
    sender: 'Tomás',
    timestampMs: 1700000000000,
    anchorMessageId: 'm1',
    starred: false,
    missing: false,
    ...patch,
  }
}

function message(patch: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    sender: 'Tomás',
    timestampMs: 1700000000000,
    text: '',
    isSystemMessage: false,
    ...patch,
  }
}

function renderThread(messages: Message[], media: MediaItem[]) {
  return render(
    <MessageThread
      messages={messages}
      anchorId={messages[0]?.id ?? 'none'}
      meParticipant={null}
      mediaById={new Map(media.map((m) => [m.id, m]))}
    />,
  )
}

const bubbleTexts = () =>
  Array.from(document.querySelectorAll('.bubble-text')).map((el) => el.textContent)

afterEach(cleanup)

describe('MessageThread attachment rendering', () => {
  it('renders an attachment chip instead of an empty bubble when the message was only a marker', () => {
    const item = mediaItem()
    renderThread([message({ mediaId: item.id })], [item])

    // The parser strips the marker to '', so there is nothing to put in a text
    // bubble — an empty one would render as a stray blank rectangle.
    expect(bubbleTexts()).toEqual([])
    expect(screen.getByText('IMG-20250300-WA0002.png')).toBeTruthy()
    expect(screen.getByText('Photo')).toBeTruthy()
  })

  it('renders the chip above the caption when the attachment had one', () => {
    const item = mediaItem({ caption: 'sunset at the beach' })
    renderThread([message({ mediaId: item.id, text: 'sunset at the beach' })], [item])

    expect(bubbleTexts()).toEqual(['sunset at the beach'])
    expect(screen.getByText('IMG-20250300-WA0002.png')).toBeTruthy()
  })

  it('marks a chip for a file missing from the export', () => {
    const item = mediaItem({ missing: true, kind: 'video', filename: 'VID-1.mp4' })
    renderThread([message({ mediaId: item.id })], [item])

    expect(screen.getByText('Video · missing')).toBeTruthy()
  })

  it('does not chip a link item, whose "file" is just a URL inside the text', () => {
    const item = mediaItem({ kind: 'link', filename: 'https://example.com/x' })
    renderThread([message({ mediaId: item.id, text: 'look at https://example.com/x' })], [item])

    expect(bubbleTexts()).toEqual(['look at https://example.com/x'])
    expect(document.querySelector('.bubble-attach')).toBeNull()
  })

  it('renders a plain message unchanged', () => {
    renderThread([message({ text: 'just chatting' })], [])

    expect(bubbleTexts()).toEqual(['just chatting'])
    expect(document.querySelector('.bubble-attach')).toBeNull()
  })

  it('shows no raw attachment marker anywhere for a real parsed export', () => {
    // End to end across the two halves of the fix: the parser strips the marker
    // out of Message.text, and the thread substitutes a chip for it.
    const source = [
      '3/9/25, 8:14 AM - Ana Ferreira: anyone on the same flight?',
      '3/9/25, 8:15 AM - Tomás Silva: ‎<attached: IMG-20250300-WA0002.png>',
      '3/9/25, 8:16 AM - Tomás Silva: ‎<attached: IMG-20250300-WA0003.png>',
      'sunset at the beach',
      '',
    ].join('\n')
    const parsed = parseChat(source, 'chat-render')
    renderThread(parsed.messages, parsed.media)

    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toContain('<attached:')
    expect(rendered).not.toContain('attached')
    expect(bubbleTexts()).toEqual(['anyone on the same flight?', 'sunset at the beach'])
    expect(screen.getByText('IMG-20250300-WA0002.png')).toBeTruthy()
  })
})
