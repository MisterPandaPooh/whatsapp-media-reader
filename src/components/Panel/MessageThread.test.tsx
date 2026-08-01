// src/components/Panel/MessageThread.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { StrictMode, type ComponentProps } from 'react'
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
type MessageThreadHandle = import('./MessageThread').MessageThreadHandle

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

  // The infinite-scroll regression this exists to stop: the window grows
  // underneath the reader, so `messages` gets a new identity many times per
  // browsing session. Re-centring on the anchor then would yank them back to
  // where they started every time they scrolled past a chunk boundary.
  it('does not re-scroll when the window grows around an unchanged anchor', () => {
    const all = makeMessages(500)
    const { rerender } = render(
      <MessageThread messages={all.slice(100, 201)} anchorId="m150" meParticipant={null} />,
    )
    expect(scrollToIndex).toHaveBeenCalledTimes(1)

    rerender(<MessageThread messages={all.slice(50, 201)} anchorId="m150" meParticipant={null} />)
    rerender(<MessageThread messages={all.slice(50, 251)} anchorId="m150" meParticipant={null} />)
    rerender(<MessageThread messages={all.slice(0, 251)} anchorId="m150" meParticipant={null} />)
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
  })

  // The tempting way to stop the effect re-firing on every window growth is a
  // ref remembering which anchor was already centred. It does not work, and
  // fails *silently*: StrictMode mounts effects, tears them down and mounts them
  // again, and refs survive that — so the guard turns the second, real mount
  // into a no-op while the virtualizer has already thrown away the first mount's
  // scroll. The panel then opens at message 1 of the window instead of centred.
  // Two calls here is the assertion that no such guard exists.
  it('issues the scroll on both of StrictMode’s effect mounts', () => {
    const messages = makeMessages(20)
    render(
      <StrictMode>
        <MessageThread messages={messages} anchorId="m3" meParticipant={null} />
      </StrictMode>,
    )
    expect(scrollToIndex).toHaveBeenCalledTimes(2)
    expect(scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'center' })
  })

  // …but "jump to message" must still work from wherever they scrolled to, and
  // against the *grown* window, where the anchor is no longer at local index 50.
  it('jumps to the anchor at its index in the grown window', () => {
    const all = makeMessages(500)
    const ref = { current: null } as { current: MessageThreadHandle | null }
    const { rerender } = render(
      <MessageThread ref={ref} messages={all.slice(100, 201)} anchorId="m150" meParticipant={null} />,
    )
    rerender(
      <MessageThread ref={ref} messages={all.slice(0, 201)} anchorId="m150" meParticipant={null} />,
    )
    scrollToIndex.mockClear()

    act(() => ref.current!.flashAnchor())
    expect(scrollToIndex).toHaveBeenCalledWith(150, { align: 'center' })
  })
})

/** jsdom reports 0 for every scroll metric; fake the three the thread reads. */
function fakeScrollMetrics(el: HTMLElement, m: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => m.scrollTop,
    set: (v: number) => {
      m.scrollTop = v
    },
  })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => m.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => m.clientHeight })
  return m
}

function renderScrollable(props: Partial<ComponentProps<typeof MessageThread>> = {}) {
  render(
    <MessageThread messages={makeMessages(101)} anchorId="m50" meParticipant={null} {...props} />,
  )
  const el = document.querySelector('.thread-scroll') as HTMLDivElement
  const metrics = fakeScrollMetrics(el, { scrollTop: 2000, scrollHeight: 6000, clientHeight: 600 })
  return { el, metrics }
}

describe('MessageThread infinite scroll', () => {
  it('asks for earlier messages when the reader nears the top', () => {
    const onExtendBefore = vi.fn()
    const { el, metrics } = renderScrollable({ hasMoreBefore: true, onExtendBefore })

    metrics.scrollTop = 3000
    fireEvent.scroll(el)
    expect(onExtendBefore).not.toHaveBeenCalled()

    metrics.scrollTop = 150
    fireEvent.scroll(el)
    expect(onExtendBefore).toHaveBeenCalledTimes(1)
  })

  it('asks for later messages when the reader nears the bottom', () => {
    const onExtendAfter = vi.fn()
    const { el, metrics } = renderScrollable({ hasMoreAfter: true, onExtendAfter })

    metrics.scrollTop = 5300 // 6000 - 5300 - 600 = 100px from the end
    fireEvent.scroll(el)
    expect(onExtendAfter).toHaveBeenCalledTimes(1)
  })

  it('stops asking at the real ends of the conversation', () => {
    const onExtendBefore = vi.fn()
    const onExtendAfter = vi.fn()
    const { el, metrics } = renderScrollable({
      hasMoreBefore: false,
      hasMoreAfter: false,
      onExtendBefore,
      onExtendAfter,
    })

    metrics.scrollTop = 0
    fireEvent.scroll(el)
    metrics.scrollTop = 5400
    fireEvent.scroll(el)
    expect(onExtendBefore).not.toHaveBeenCalled()
    expect(onExtendAfter).not.toHaveBeenCalled()
  })

  // The whole point. Content grows *above* the viewport and the browser keeps
  // scrollTop, so everything the reader was looking at slides down the screen
  // by exactly the height that was inserted. Push scrollTop by that height and
  // the words under their eyes do not move.
  it('compensates scrollTop by the height that was prepended', () => {
    const { el, metrics } = renderScrollable({
      hasMoreBefore: true,
      // Stands in for the 50 newly prepended rows the virtualizer sizes at its
      // estimate; the component must read the growth, not assume it.
      onExtendBefore: () => {
        metrics.scrollHeight = 8800
      },
    })

    metrics.scrollTop = 150
    fireEvent.scroll(el)
    expect(el.scrollTop).toBe(150 + 2800)
  })

  it('does not touch scrollTop when extending downwards', () => {
    const { el, metrics } = renderScrollable({
      hasMoreAfter: true,
      onExtendAfter: () => {
        metrics.scrollHeight = 8800
      },
    })

    metrics.scrollTop = 5300
    fireEvent.scroll(el)
    expect(el.scrollTop).toBe(5300)
  })
})
