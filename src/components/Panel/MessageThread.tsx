// src/components/Panel/MessageThread.tsx
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BubbleMedia } from './BubbleMedia'
import type { MediaItem, Message, StorageRef } from '../../types'

/** How close to an edge the reader gets before the next chunk is pulled in.
 *  Deliberately several rows' worth: the extension should land while there is
 *  still content under the scrollbar, not after they have hit the wall. */
const EXTEND_THRESHOLD_PX = 400

function dateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** For an attachment the export left out — there is no filename to show. */
const OMITTED_LABEL: Record<MediaItem['kind'], string> = {
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice note',
  doc: 'Document',
  link: 'Link',
}

/** Stable per-sender colour so bubbles are visually attributable at a glance. */
const SENDER_COLORS = [
  '#1f7a5a',
  '#8a4b9c',
  '#b4530a',
  '#0e6ba8',
  '#a1345c',
  '#4d7c0f',
  '#6d4bd8',
  '#0f766e',
]

function senderColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]
}

interface Props {
  messages: Message[]
  anchorId: string
  meParticipant: string | null
  /** Media by id, for the in-bubble preview. The parser strips the raw
   *  `<attached: …>` marker out of `Message.text`, so without this the file a
   *  message carried would be invisible in the thread — and a message that was
   *  nothing but a marker would render as an empty bubble. */
  mediaById?: ReadonlyMap<string, MediaItem>
  /** Where to read attachment bytes from. Omitted, bubbles fall back to text
   *  only — which is what the thread's own unit tests rely on, since jsdom has
   *  neither OPFS nor object URLs. */
  storageRef?: StorageRef
  /** Selects an attachment in the reader when its preview is clicked. */
  onOpenMedia?: (mediaId: string) => void
  /** Whether the chat continues past either edge of `messages`. False on both
   *  means this window is the whole conversation. */
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  /** Widen `messages` by a chunk. Called from the scroll handler; must update
   *  synchronously (it is wrapped in flushSync) so the prepended height can be
   *  measured and cancelled out before the browser paints. */
  onExtendBefore?: () => void
  onExtendAfter?: () => void
}

export interface MessageThreadHandle {
  flashAnchor: () => void
}

export const MessageThread = forwardRef<MessageThreadHandle, Props>(function MessageThread(
  {
    messages,
    anchorId,
    meParticipant,
    mediaById,
    storageRef,
    onOpenMedia,
    hasMoreBefore = false,
    hasMoreAfter = false,
    onExtendBefore,
    onExtendAfter,
  },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null)
  // Bumped on every "jump to message"; the odd/even class swap below restarts
  // the CSS animation when the button is clicked again mid-flash.
  const [flashSeq, setFlashSeq] = useState(0)
  const flashTimer = useRef<number | null>(null)

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    // Rough first guess only — every row re-measures itself via `measureElement`
    // below, because bubbles are genuinely variable height (wrapped text,
    // day separators, system lines).
    estimateSize: () => 56,
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: 8,
    // Row measurement happens inside a layout effect; letting the virtualizer
    // flushSync from there makes React log "flushSync was called from inside a
    // lifecycle method" for every row. The tradeoff: this also opts out of the
    // synchronous commit virtual-core asks for, so a one-frame flicker is
    // theoretically possible. Harmless for a 101-row text list, and the size
    // cache it scrolls against updates synchronously either way.
    useFlushSync: false,
  })

  // The window array is read through a ref, not closed over, so that
  // `scrollToAnchor`'s identity depends only on which message we are aiming at.
  // Infinite scroll replaces `messages` every time the reader crosses a chunk
  // boundary; if that changed this callback's identity it would re-fire the
  // centring effect below and yank them back to the anchor mid-read. Written in
  // a *layout* effect so it is already up to date when the passive effect below
  // runs in the same commit.
  const messagesRef = useRef(messages)
  useLayoutEffect(() => {
    messagesRef.current = messages
  })

  // Deliberately reads the index at call time rather than taking it as a prop:
  // the anchor's local index moves every time a chunk is prepended, and "Jump to
  // message" must still find it after the reader has scrolled a long way off.
  const scrollToAnchor = useCallback(() => {
    const index = messagesRef.current.findIndex((m) => m.id === anchorId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
  }, [anchorId, virtualizer])

  // Centring the anchor is the whole point of this component. A scroll issued
  // before the rows have measured would be computed from the estimate above and
  // land in the wrong place, but virtual-core keeps re-targeting a scrollToIndex
  // across animation frames until the measured offset settles, so one call per
  // anchor change is enough. Verified in the browser: the anchor lands within
  // ~20px of the viewport centre on open and on every prev/next step.
  //
  // Note what this is NOT keyed on. Not the anchor's *index*: the opening window
  // clamps the anchor to local index 50, so the index is 50 both before and
  // after a prev/next step for any media item more than 50 messages into the
  // chat, and keying on it would silently skip the re-centre for essentially
  // every real item. And not the window array, per the ref above. It is also
  // deliberately not guarded by an "already centred this anchor" ref: StrictMode mounts
  // effects, tears them down and mounts them again while refs survive, so such a
  // guard makes the second — real — mount a no-op and nothing ever scrolls.
  useEffect(() => {
    scrollToAnchor()
  }, [scrollToAnchor])

  const canExtendBefore = hasMoreBefore && !!onExtendBefore
  const canExtendAfter = hasMoreAfter && !!onExtendAfter

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return

    if (canExtendBefore && el.scrollTop < EXTEND_THRESHOLD_PX) {
      // Prepending grows the content *above* the viewport while the browser
      // holds scrollTop still, so everything on screen slides down by exactly
      // the height that was inserted. Cancel it out.
      //
      // flushSync is what makes the arithmetic trustworthy. `scroll` is a
      // continuous event, so React would otherwise commit the wider window in a
      // later task — by which time the reader may have scrolled again and
      // `before` would be stale. Forcing the commit inside the handler pins both
      // readings to the same instant, and the correction lands before paint.
      const before = el.scrollTop
      const heightBefore = el.scrollHeight
      flushSync(onExtendBefore!)
      const grew = el.scrollHeight - heightBefore
      // `before + grew`, not `el.scrollTop + grew`: the virtualizer measures the
      // newly rendered rows during that commit and applies its own first-measure
      // scroll corrections, so scrollTop has already moved. The height delta
      // already accounts for those measurements — adding it to the live
      // scrollTop would count them twice.
      if (grew > 0) el.scrollTop = before + grew
      return
    }

    if (canExtendAfter && el.scrollHeight - el.scrollTop - el.clientHeight < EXTEND_THRESHOLD_PX) {
      // Appending needs no compensation: the content grows below the fold and
      // every offset above it is unchanged.
      onExtendAfter!()
    }
  }, [canExtendBefore, canExtendAfter, onExtendBefore, onExtendAfter])

  // Guard against a pending flash timer firing after unmount.
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      flashAnchor: () => {
        scrollToAnchor()
        setFlashSeq((n) => n + 1)
        if (flashTimer.current !== null) clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlashSeq(0), 900)
      },
    }),
    [scrollToAnchor],
  )

  if (messages.length === 0) {
    return (
      <div className="thread-scroll thread-scroll--empty">
        <p className="thread-empty">The message this file came from is not in this chat export.</p>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="thread-scroll"
      onScroll={handleScroll}
      // Focusable so keyboard users can scroll the conversation (WCAG 2.1.1);
      // a scroll container with no focusable content is otherwise unreachable.
      tabIndex={0}
      role="log"
      aria-label="Conversation"
    >
      <div className="thread-sizer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const m = messages[row.index]
          const prev = messages[row.index - 1]
          const dayBreak = !prev || dateKey(prev.timestampMs) !== dateKey(m.timestampMs)
          const mine = meParticipant !== null && m.sender === meParticipant
          const isAnchor = m.id === anchorId
          const sameSenderAsPrev =
            !dayBreak && !!prev && !prev.isSystemMessage && prev.sender === m.sender
          const attachment = m.mediaId ? mediaById?.get(m.mediaId) : undefined
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="thread-row"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {/* Only meaningful once infinite scroll is wired up: with it, an
                  exhausted upward extension really is the first line of the
                  export, and without the marker the reader cannot tell that
                  from a chunk that has not loaded yet. Rendered inside row 0
                  so the virtualizer measures it like any other content. */}
              {row.index === 0 && onExtendBefore && !hasMoreBefore && (
                <div className="thread-start">
                  <span>Beginning of this conversation</span>
                </div>
              )}
              {dayBreak && (
                <div className="day-sep">
                  <span>{DAY_FMT.format(m.timestampMs)}</span>
                </div>
              )}
              {m.isSystemMessage ? (
                <div className="system-line">
                  <span>{m.text}</span>
                </div>
              ) : (
                <div className={`bubble-row${mine ? ' bubble-row--mine' : ''}`}>
                  <div
                    className={`bubble${isAnchor ? ' bubble--anchor' : ''}${
                      isAnchor && flashSeq > 0
                        ? flashSeq % 2 === 1
                          ? ' bubble--flash-a'
                          : ' bubble--flash-b'
                        : ''
                    }`}
                  >
                    {!mine && !sameSenderAsPrev && (
                      <div className="bubble-sender" style={{ color: senderColor(m.sender) }}>
                        {m.sender}
                      </div>
                    )}
                    {attachment && (
                      <BubbleMedia
                        item={attachment}
                        storageRef={storageRef}
                        onOpen={onOpenMedia}
                      />
                    )}
                    {m.omittedMedia && (
                      <div className="bubble-attach bubble-attach--missing">
                        <span className="bubble-attach-kind">{OMITTED_LABEL[m.omittedMedia]}</span>
                        <span className="bubble-attach-name">not included in this export</span>
                      </div>
                    )}
                    {/* Empty only for a message that was nothing but an
                        attachment marker — the chip above stands in for it. */}
                    {m.text !== '' && <div className="bubble-text">{m.text}</div>}
                    <div className="bubble-time">{TIME_FMT.format(m.timestampMs)}</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
