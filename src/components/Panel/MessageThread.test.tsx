// src/components/Panel/MessageThread.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Message } from '../../types'
import { threadWindow } from '../../store/selectors'

const scrollToIndex = vi.fn()

// The real virtualizer needs layout jsdom does not provide; all these tests
// care about is *when* the component asks to scroll, and to what index.
// The instance MUST be a singleton: react-virtual v3 creates the Virtualizer
// once (`const [instance] = React.useState(...)`) and returns that same object
// on every render. A mock that returns a fresh object each render would change
// every memo/effect dependency that includes it and hide exactly the class of
// bug these tests exist to catch.
const virtualizerStub = {
  scrollToIndex,
  getTotalSize: () => 0,
  getVirtualItems: () => [],
  measureElement: () => {},
}
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizerStub,
}))

const { MessageThread } = await import('./MessageThread')

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    sender: i % 2 === 0 ? 'Alice' : 'Bob',
    timestampMs: 1700000000000 + i * 60_000,
    text: `Message ${i}`,
    isSystemMessage: false,
  }))
}

beforeEach(() => {
  scrollToIndex.mockClear()
})
afterEach(cleanup)

describe('MessageThread anchor scrolling', () => {
  it('re-scrolls when the window changes but the local anchor index does not', () => {
    // threadWindow clamps to ±50, so any anchor at least 50 messages into the
    // chat sits at local index 50 — the same index before and after a
    // prev/next step. Keying the scroll effect on the index alone therefore
    // silently skips the re-centre for essentially every real media item.
    const messages = makeMessages(500)
    const first = threadWindow(messages, 'm150')
    const second = threadWindow(messages, 'm300')
    expect(first.findIndex((m) => m.id === 'm150')).toBe(50)
    expect(second.findIndex((m) => m.id === 'm300')).toBe(50)

    const { rerender } = render(
      <MessageThread messages={first} anchorId="m150" meParticipant={null} />,
    )
    expect(scrollToIndex).toHaveBeenCalledTimes(1)

    rerender(<MessageThread messages={second} anchorId="m300" meParticipant={null} />)
    expect(scrollToIndex).toHaveBeenCalledTimes(2)
    expect(scrollToIndex).toHaveBeenLastCalledWith(50, { align: 'center' })
  })

  it('re-scrolls when the anchor moves within the same window', () => {
    const messages = makeMessages(20)
    const { rerender } = render(
      <MessageThread messages={messages} anchorId="m3" meParticipant={null} />,
    )
    expect(scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'center' })

    rerender(<MessageThread messages={messages} anchorId="m9" meParticipant={null} />)
    expect(scrollToIndex).toHaveBeenCalledTimes(2)
    expect(scrollToIndex).toHaveBeenLastCalledWith(9, { align: 'center' })
  })

  it('does not scroll when the anchor is not in the window', () => {
    render(<MessageThread messages={[]} anchorId="nope" meParticipant={null} />)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('does not re-scroll on an unrelated re-render', () => {
    const messages = makeMessages(20)
    const { rerender } = render(
      <MessageThread messages={messages} anchorId="m3" meParticipant={null} />,
    )
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    rerender(<MessageThread messages={messages} anchorId="m3" meParticipant="Bob" />)
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
  })
})
