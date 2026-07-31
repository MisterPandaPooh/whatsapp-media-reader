// src/components/Panel/DetailPanel.tsx
import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { threadWindow } from '../../store/selectors'
import { readMediaFile } from '../../storage/fileAccess'
import { MessageThread, type MessageThreadHandle } from './MessageThread'
import type { MediaItem, Message, StorageRef } from '../../types'
import './Panel.css'

interface Props {
  activeItem: MediaItem
  messages: Message[]
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

export function DetailPanel({ activeItem, messages, filteredIds, meParticipant, storageRef }: Props) {
  const openMedia = useChatStore((s) => s.openMedia)
  const closePanel = useChatStore((s) => s.closePanel)
  const toggleStarred = useChatStore((s) => s.toggleStarred)
  const threadRef = useRef<MessageThreadHandle>(null)
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

  const position = filteredIds.indexOf(activeItem.id)
  const messageWindow = threadWindow(messages, activeItem.anchorMessageId)
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
    if (position === -1) return
    const next = filteredIds[position + delta]
    if (next) openMedia(next)
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
  const canNext = position >= 0 && position < filteredIds.length - 1

  return (
    <aside className="detail-panel" aria-label="Message detail">
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
            <video src={previewUrl} muted playsInline preload="metadata" />
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
      />
    </aside>
  )
}
