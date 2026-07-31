// src/components/Grid/MediaTile.tsx
import type { KeyboardEvent } from 'react'
import type { MediaItem, StorageRef } from '../../types'
import { useLazyThumbnail } from './useLazyThumbnail'
import { useChatStore } from '../../store/useChatStore'

interface Props {
  item: MediaItem
  storageRef: StorageRef
  selected: boolean
  onOpen: (id: string) => void
  /** Scroll container used as the IntersectionObserver root. */
  scrollRoot: Element | null
}

function badgeLabel(item: MediaItem): string {
  if (item.kind === 'link') return 'LINK'
  if (item.kind === 'voice') return 'VOICE'
  const ext = item.filename.includes('.') ? item.filename.split('.').pop() : ''
  return ext ? ext.toUpperCase() : 'FILE'
}

export function MediaTile({ item, storageRef, selected, onOpen, scrollRoot }: Props) {
  // Only visual media that actually exists on disk is worth fetching.
  const isVisual = item.kind === 'photo' || item.kind === 'video'
  const { ref, url } = useLazyThumbnail<HTMLDivElement>(
    storageRef,
    item.filename,
    item.kind,
    isVisual && !item.missing,
    scrollRoot,
  )
  const toggleStarred = useChatStore((s) => s.toggleStarred)

  const label = item.caption || item.filename || item.kind
  // doc/voice/link cards print the caption in their own body, so the
  // photo-style gradient overlay would just duplicate it.
  const showFileCard = !item.missing && !isVisual

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(item.id)
    }
  }

  return (
    // A <div role="button"> rather than a <button>: the star toggle below is
    // itself a button, and nested interactive elements are invalid HTML.
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={selected || undefined}
      className={`media-tile media-tile--${item.kind}${selected ? ' media-tile--selected' : ''}`}
      onClick={() => onOpen(item.id)}
      onKeyDown={handleKeyDown}
    >
      {item.missing ? (
        <div className="tile-missing">Missing</div>
      ) : isVisual ? (
        <>
          {url ? (
            item.kind === 'video' ? (
              // #t=0.1 nudges the browser to decode and paint a first frame.
              <video className="tile-media" src={`${url}#t=0.1`} preload="metadata" muted playsInline />
            ) : (
              <img className="tile-media" src={url} alt={label} loading="lazy" decoding="async" />
            )
          ) : (
            <div className="tile-placeholder" />
          )}
          {item.kind === 'video' && <span className="tile-play" aria-hidden="true">▶</span>}
        </>
      ) : (
        <div className="tile-file">
          <span className="tile-ext">{badgeLabel(item)}</span>
          <span className="tile-caption">{item.caption || item.filename}</span>
        </div>
      )}

      {item.caption && !showFileCard && (
        <div className="tile-overlay">
          <span className="tile-caption-text">{item.caption}</span>
        </div>
      )}

      <button
        type="button"
        className={`tile-star${item.starred ? ' tile-star--on' : ''}`}
        aria-pressed={item.starred}
        aria-label={item.starred ? 'Unstar' : 'Star'}
        onClick={(e) => {
          // Must not also open the detail panel.
          e.stopPropagation()
          toggleStarred(item.id)
        }}
      >
        ★
      </button>
    </div>
  )
}
