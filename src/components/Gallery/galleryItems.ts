import type { MediaItem } from '../../types'

/**
 * What a fullscreen gallery can actually display. A document or a voice note
 * has nothing to show at full size, and a missing file has no bytes at all —
 * including them would put dead slides between the photos.
 */
export function galleryItems(media: MediaItem[]): MediaItem[] {
  return media.filter((m) => !m.missing && (m.kind === 'photo' || m.kind === 'video'))
}
