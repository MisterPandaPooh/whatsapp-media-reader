// src/components/Panel/DetailPanel.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { extendThreadRange, threadRange } from '../../store/selectors'
import { readMediaFile } from '../../storage/fileAccess'
import { MessageThread, type MessageThreadHandle } from './MessageThread'
import type { MediaItem, Message, StorageRef } from '../../types'
import './Panel.css'

interface Props {
  activeItem: MediaItem
  messages: Message[]
  /** The chat's *whole* media list, not the filtered one: the thread window can
   *  contain messages whose attachment is currently filtered out of the grid,
   *  and those still need their chip. */
  allMedia: MediaItem[]
  filteredIds: string[]
  meParticipant: string | null
  storageRef: StorageRef
}

const KIND_LABEL: Record<MediaItem['kind'], string> = {
  photo: 'Photo',
  video: 'Video',
  doc: 'Document',
  voice: 'Voice note',
  link: 'Link',
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DetailPanel({
  activeItem,
  messages,
  allMedia,
  filteredIds,
  meParticipant,
  storageRef,
}: Props) {
  const openMedia = useChatStore((s) => s.openMedia)
  const closePanel = useChatStore((s) => s.closePanel)
  const toggleStarred = useChatStore((s) => s.toggleStarred)
  const threadRef = useRef<MessageThreadHandle>(null)
  const panelRef = useRef<HTMLElement>(null)
  const alive = useRef(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Move focus into the panel on open so Escape and Tab land here, and hand it
  // back to whatever opened it (the grid tile) on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  const position = filteredIds.indexOf(activeItem.id)

  // The infinite-scroll window lives here rather than in MessageThread because
  // this is where the chat's *whole* messages array already is, along with the
  // memoisation that keeps a six-figure scan off the render path. MessageThread
  // stays what it was: a view over a slice, which is also what keeps its scroll
  // container the only thing it owns.
  //
  // Reset-on-anchor-change is done with the "adjust state during render"
  // pattern rather than an effect. An effect would render one frame of the old
  // item's window under the new item's anchor — MessageThread would centre on
  // an anchor that is not there yet, then be told to centre again.
  const [range, setRange] = useState(() => threadRange(messages, activeItem.anchorMessageId))
  const [rangeFor, setRangeFor] = useState({ messages, anchorId: activeItem.anchorMessageId })
  if (rangeFor.messages !== messages || rangeFor.anchorId !== activeItem.anchorMessageId) {
    setRangeFor({ messages, anchorId: activeItem.anchorMessageId })
    setRange(threadRange(messages, activeItem.anchorMessageId))
  }

  // Slicing is cheap; the scan that produced `range` is not. Memoised so the
  // panel's other re-renders (every search keystroke reaches here) hand
  // MessageThread the same array identity and leave its scroll position alone.
  const messageWindow = useMemo(
    () => messages.slice(range.start, range.end),
    [messages, range],
  )
  const extendBefore = useCallback(
    () => setRange((r) => extendThreadRange(r, 'before', messages.length)),
    [messages.length],
  )
  const extendAfter = useCallback(
    () => setRange((r) => extendThreadRange(r, 'after', messages.length)),
    [messages.length],
  )
  // Built once per chat rather than per render: `allMedia` can be six figures
  // long, and the panel re-renders on every search keystroke.
  const mediaById = useMemo(() => new Map(allMedia.map((m) => [m.id, m])), [allMedia])
  const previewable = !activeItem.missing && (activeItem.kind === 'photo' || activeItem.kind === 'video')

  // Object URL for the preview thumbnail, revoked whenever the item changes or
  // the panel unmounts. `stale` guards against an out-of-order async resolve.
  useEffect(() => {
    if (!previewable) {
      setPreviewUrl(null)
      return
    }
    let stale = false
    let url: string | null = null
    void readMediaFile(storageRef, activeItem.filename).then((file) => {
      if (stale || !file) return
      url = URL.createObjectURL(file)
      setPreviewUrl(url)
    })
    return () => {
      stale = true
      setPreviewUrl(null)
      if (url) URL.revokeObjectURL(url)
    }
  }, [previewable, storageRef, activeItem.filename])

  // Clear a stale "file is missing" notice when stepping to another item.
  useEffect(() => setError(null), [activeItem.id])

  function step(delta: number) {
    // The active item can fall outside the current filter (the user narrowed
    // the filters while it was open). Rather than dead-ending with Close as the
    // only exit, let Next drop back into the filtered set at the start.
    if (position === -1) {
      if (delta > 0 && filteredIds.length > 0) openMedia(filteredIds[0])
      return
    }
    const next = filteredIds[position + delta]
    if (next) openMedia(next)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    // The Toolbar closes its popovers from a *capture*-phase window listener,
    // which therefore runs before this one and calls preventDefault(). Honour
    // that, or a single Escape pressed while a popover is open would both
    // dismiss the popover and close the panel.
    if (e.key !== 'Escape' || e.defaultPrevented) return
    // Scoped to the panel subtree rather than a window listener. The
    // propagation stop keeps this Escape from also reaching the app shell's
    // bubble-phase window handler (React's stopPropagation stops the native
    // event at the root container, before it can bubble to window).
    e.stopPropagation()
    closePanel()
  }

  async function handleDownload() {
    if (activeItem.kind === 'link' || downloading) return
    setDownloading(true)
    setError(null)
    const file = await readMediaFile(storageRef, activeItem.filename)
    // The panel may have closed while the file was being read: finish the
    // download the user asked for, but do not touch state after unmount.
    if (alive.current) setDownloading(false)
    if (!file) {
      if (alive.current) {
        setError('This file is missing from the export and cannot be downloaded.')
      }
      return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = activeItem.filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    // Revoke on the next task, not synchronously: some browsers abort the
    // download if the blob URL disappears in the same tick as the click.
    setTimeout(() => {
      a.remove()
      URL.revokeObjectURL(url)
    }, 0)
  }

  const canPrev = position > 0
  const canNext =
    position === -1 ? filteredIds.length > 0 : position < filteredIds.length - 1

  return (
    <aside
      ref={panelRef}
      className="detail-panel"
      aria-label="Message detail"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="panel-header">
        <div className="panel-title">In conversation</div>
        <div className="panel-position">
          {position >= 0 ? position + 1 : '—'} of {filteredIds.length}
        </div>
        <div className="panel-spacer" />
        <button
          type="button"
          className="panel-icon-btn"
          onClick={() => step(-1)}
          disabled={!canPrev}
          title="Previous item"
          aria-label="Previous item"
        >
          ↑
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={() => step(1)}
          disabled={!canNext}
          title="Next item"
          aria-label="Next item"
        >
          ↓
        </button>
        <button
          type="button"
          className="panel-icon-btn"
          onClick={closePanel}
          title="Close panel"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="panel-preview">
        <div className={`preview-thumb preview-thumb--${activeItem.kind}`}>
          {previewUrl && activeItem.kind === 'photo' && <img src={previewUrl} alt="" />}
          {previewUrl && activeItem.kind === 'video' && (
            // The media fragment seeks to the first frame; without it the
            // element paints an empty box until it is played.
            <video src={`${previewUrl}#t=0.1`} muted playsInline preload="metadata" />
          )}
          {!previewUrl && (
            <span className="preview-thumb-label">
              {activeItem.missing ? 'Missing' : KIND_LABEL[activeItem.kind]}
            </span>
          )}
        </div>
        <div className="preview-info">
          <div className="preview-caption">{activeItem.caption || activeItem.filename}</div>
          <div className="preview-meta">
            {activeItem.filename}
            {formatSize(activeItem.size) ? ` · ${formatSize(activeItem.size)}` : ''}
          </div>
          <div className="preview-meta">
            {activeItem.sender} · {new Date(activeItem.timestampMs).toLocaleString()}
          </div>
          <div className="preview-actions">
            <button
              type="button"
              className={`panel-action-btn${activeItem.starred ? ' panel-action-btn--on' : ''}`}
              onClick={() => toggleStarred(activeItem.id)}
              aria-pressed={activeItem.starred}
            >
              {activeItem.starred ? '★ Starred' : '☆ Star'}
            </button>
            <button
              type="button"
              className="panel-action-btn"
              onClick={handleDownload}
              disabled={downloading || activeItem.kind === 'link' || activeItem.missing}
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
            <button
              type="button"
              className="panel-action-btn"
              onClick={() => threadRef.current?.flashAnchor()}
            >
              Jump to message
            </button>
          </div>
          {error && <div className="panel-error">{error}</div>}
        </div>
      </div>

      <MessageThread
        ref={threadRef}
        messages={messageWindow}
        anchorId={activeItem.anchorMessageId}
        meParticipant={meParticipant}
        mediaById={mediaById}
        storageRef={storageRef}
        onOpenMedia={openMedia}
        hasMoreBefore={range.start > 0}
        hasMoreAfter={range.end < messages.length}
        onExtendBefore={extendBefore}
        onExtendAfter={extendAfter}
      />
    </aside>
  )
}
