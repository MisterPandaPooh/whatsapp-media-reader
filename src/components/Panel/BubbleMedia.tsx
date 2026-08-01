import { useMediaObjectUrl } from './useMediaObjectUrl'
import type { MediaItem, StorageRef } from '../../types'

const KIND_LABEL: Record<MediaItem['kind'], string> = {
  photo: 'Photo',
  video: 'Video',
  doc: 'Document',
  voice: 'Voice note',
  link: 'Link',
}

/** Kinds whose bytes are worth reading to show something in the thread. A doc
 *  has no renderable preview and a link is already the message text, so both
 *  keep the filename chip and never touch storage. */
function isPreviewable(item: MediaItem): boolean {
  if (item.missing) return false
  return item.kind === 'photo' || item.kind === 'video' || item.kind === 'voice'
}

interface Props {
  item: MediaItem
  /** Omitted when there is nowhere to read bytes from; the chip stands in. */
  storageRef?: StorageRef
  /** Makes the preview a control that selects this item in the reader. */
  onOpen?: (mediaId: string) => void
}

/**
 * The media a message carried, shown inside its bubble.
 *
 * Height is deliberately fixed by CSS rather than derived from the file: the
 * thread is virtualized with dynamic row measurement, so a preview that grew
 * when its image decoded would re-measure the row and shift everything below it
 * — under the reader's cursor, mid-scroll. Reserving the space up front means
 * the loading and loaded states occupy exactly the same box.
 *
 * Nothing here needs an IntersectionObserver: virtualization only mounts rows
 * near the viewport, so mounting is already the "is it visible" signal.
 */
export function BubbleMedia({ item, storageRef, onOpen }: Props) {
  const previewable = !!storageRef && isPreviewable(item)
  const url = useMediaObjectUrl(storageRef, item.filename, previewable)
  const label = KIND_LABEL[item.kind]

  if (item.kind === 'link') return null

  // Documents, and anything absent from the export, keep the compact chip.
  if (!previewable) {
    return (
      <div className={`bubble-attach${item.missing ? ' bubble-attach--missing' : ''}`}>
        <span className="bubble-attach-kind">
          {item.missing ? `${label} · missing` : label}
        </span>
        <span className="bubble-attach-name">{item.filename}</span>
      </div>
    )
  }

  if (item.kind === 'voice') {
    return (
      <div className="bubble-voice">
        <span className="bubble-attach-kind">{label}</span>
        {url ? (
          // `preload="none"`: several voice notes can be mounted at once, and
          // none of them should pull bytes until the reader actually plays one.
          <audio className="bubble-audio" src={url} controls preload="none" />
        ) : (
          <div className="bubble-audio-placeholder" />
        )}
      </div>
    )
  }

  const visual = (
    <>
      {url && item.kind === 'photo' && (
        <img className="bubble-media-el" src={url} alt={item.caption || item.filename} />
      )}
      {url && item.kind === 'video' && (
        // `#t=0.1` seeks a fraction in so the element paints a real frame
        // instead of a black one; metadata alone is enough to get it.
        <video className="bubble-media-el" src={`${url}#t=0.1`} preload="metadata" muted />
      )}
      {!url && <div className="bubble-media-placeholder" />}
      {item.kind === 'video' && <span className="bubble-media-play" aria-hidden="true" />}
    </>
  )

  if (!onOpen) return <div className="bubble-media">{visual}</div>

  return (
    <button
      type="button"
      className="bubble-media bubble-media--button"
      onClick={() => onOpen(item.id)}
      title={item.filename}
      aria-label={`${label}: ${item.caption || item.filename}`}
    >
      {visual}
    </button>
  )
}
