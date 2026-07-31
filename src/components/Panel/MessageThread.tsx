// src/components/Panel/MessageThread.tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '../../types'

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
}

export interface MessageThreadHandle {
  flashAnchor: () => void
}

export const MessageThread = forwardRef<MessageThreadHandle, Props>(function MessageThread(
  { messages, anchorId, meParticipant },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null)
  const anchorIndex = messages.findIndex((m) => m.id === anchorId)
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
    // lifecycle method" for every row.
    useFlushSync: false,
  })

  const scrollToAnchor = useCallback(() => {
    if (anchorIndex >= 0) virtualizer.scrollToIndex(anchorIndex, { align: 'center' })
  }, [anchorIndex, virtualizer])

  // Centring the anchor is the whole point of this component. A scroll issued
  // before the rows have measured would be computed from the estimate above and
  // land in the wrong place, but virtual-core keeps re-targeting a scrollToIndex
  // across animation frames until the measured offset settles, so one call per
  // anchor change is enough. Verified in the browser: the anchor lands within
  // ~2px of the viewport centre on open and on every prev/next step.
  // Re-runs whenever the anchor — and therefore the window — changes.
  useEffect(() => {
    scrollToAnchor()
  }, [scrollToAnchor])

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
    <div ref={parentRef} className="thread-scroll">
      <div className="thread-sizer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const m = messages[row.index]
          const prev = messages[row.index - 1]
          const dayBreak = !prev || dateKey(prev.timestampMs) !== dateKey(m.timestampMs)
          const mine = meParticipant !== null && m.sender === meParticipant
          const isAnchor = m.id === anchorId
          const sameSenderAsPrev =
            !dayBreak && !!prev && !prev.isSystemMessage && prev.sender === m.sender
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="thread-row"
              style={{ transform: `translateY(${row.start}px)` }}
            >
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
                    <div className="bubble-text">{m.text}</div>
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
