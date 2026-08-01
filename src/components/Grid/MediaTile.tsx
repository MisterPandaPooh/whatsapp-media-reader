// src/components/Grid/MediaTile.tsx
import type { MediaItem, StorageRef } from '../../types'
import { useLazyThumbnail } from './useLazyThumbnail'
import { useChatStore } from '../../store/useChatStore'

interface Props {
  item: MediaItem
  storageRef: StorageRef
  selected: boolean
  onOpen: (id: string) => void
  /** Double-click straight into the fullscreen gallery. Absent for a kind the
   *  gallery cannot show, so the second click is simply a second open. */
  onOpenFullscreen?: (id: string) => void
  /** Scroll container used as the IntersectionObserver root. */
  scrollRoot: Element | null
}

function badgeLabel(item: MediaItem): string {
  if (item.kind === 'link') return 'LINK'
  if (item.kind === 'voice') return 'VOICE'
  const ext = item.filename.includes('.') ? item.filename.split('.').pop() : ''
  return ext ? ext.toUpperCase() : 'FILE'
}

export function MediaTile({
  item,
  storageRef,
  selected,
  onOpen,
  onOpenFullscreen,
  scrollRoot,
}: Props) {
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

  return (
    // The tile itself is a plain container. The two controls are siblings, not
    // nested: a <button> inside a <button> is a parse error, and role="button"
    // is "children presentational", which would strip the star's own role and
    // label from the accessibility tree.
    <div
      ref={ref}
      className={`media-tile media-tile--${item.kind}${selected ? ' media-tile--selected' : ''}`}
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
              // Decorative: the open button below carries the accessible name.
              <img className="tile-media" src={url} alt="" decoding="async" />
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

      {/* Full-bleed transparent hit target, stacked under the star. */}
      <button
        type="button"
        className="tile-open"
        aria-label={label}
        aria-current={selected || undefined}
        onClick={() => onOpen(item.id)}
        // dblclick fires after both clicks, so the panel has already opened
        // behind the gallery and is where the reader lands on closing it.
        onDoubleClick={onOpenFullscreen && (() => onOpenFullscreen(item.id))}
      />

      <button
        type="button"
        className={`tile-star${item.starred ? ' tile-star--on' : ''}`}
        aria-pressed={item.starred}
        aria-label={item.starred ? 'Unstar' : 'Star'}
        onClick={() => toggleStarred(item.id)}
      >
        ★
      </button>
    </div>
  )
}
