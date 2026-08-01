// src/components/Panel/BubbleMedia.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { MediaItem, StorageRef } from '../../types'

const readMediaFile = vi.fn()
vi.mock('../../storage/fileAccess', () => ({
  readMediaFile: (...args: unknown[]) => readMediaFile(...args),
}))

const { BubbleMedia } = await import('./BubbleMedia')

const storageRef: StorageRef = { kind: 'opfs', folder: 'chat-1' }

function media(patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm1',
    kind: 'photo',
    filename: 'IMG-0001.jpg',
    size: 1024,
    caption: 'sunset',
    sender: 'Ana',
    timestampMs: Date.UTC(2025, 8, 3, 10, 0),
    anchorMessageId: 'msg1',
    starred: false,
    missing: false,
    ...patch,
  }
}

const revoke = vi.spyOn(URL, 'revokeObjectURL')

beforeEach(() => {
  readMediaFile.mockResolvedValue(new File(['x'], 'IMG-0001.jpg'))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  revoke.mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BubbleMedia', () => {
  it('renders a photo preview once the file resolves', async () => {
    render(<BubbleMedia item={media()} storageRef={storageRef} />)
    const img = await screen.findByRole('img')
    expect(img).toHaveProperty('src', 'blob:fake')
  })

  it('renders a video element, not an image, for a video', async () => {
    const { container } = render(<BubbleMedia item={media({ kind: 'video' })} storageRef={storageRef} />)
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders a playable audio element for a voice note', async () => {
    const { container } = render(<BubbleMedia item={media({ kind: 'voice' })} storageRef={storageRef} />)
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    expect(container.querySelector('audio')).toHaveProperty('controls', true)
  })

  // A document has no renderable preview, so reading its bytes would be pure
  // waste — several megabytes pulled off disk to show a filename.
  it('shows the chip for a document and never touches storage', () => {
    render(<BubbleMedia item={media({ kind: 'doc', filename: 'report.pdf' })} storageRef={storageRef} />)
    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(readMediaFile).not.toHaveBeenCalled()
  })

  it('shows a missing chip and never touches storage for an absent file', () => {
    render(<BubbleMedia item={media({ missing: true })} storageRef={storageRef} />)
    expect(screen.getByText(/missing/i)).toBeTruthy()
    expect(readMediaFile).not.toHaveBeenCalled()
  })

  // The URL is already in the message text; a preview box would be noise.
  it('renders nothing at all for a link', () => {
    const { container } = render(
      <BubbleMedia item={media({ kind: 'link', filename: 'https://example.com' })} storageRef={storageRef} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('falls back to the chip when there is nowhere to read bytes from', () => {
    render(<BubbleMedia item={media()} />)
    expect(screen.getByText('IMG-0001.jpg')).toBeTruthy()
    expect(readMediaFile).not.toHaveBeenCalled()
  })

  it('exposes the preview as a button when it can be opened', async () => {
    const onOpen = vi.fn()
    render(<BubbleMedia item={media()} storageRef={storageRef} onOpen={onOpen} />)
    const button = await screen.findByRole('button')
    button.click()
    expect(onOpen).toHaveBeenCalledWith('m1')
  })

  it('is not a button when no open handler was given', async () => {
    render(<BubbleMedia item={media()} storageRef={storageRef} />)
    await screen.findByRole('img')
    expect(screen.queryByRole('button')).toBeNull()
  })

  // Thread rows unmount constantly as the reader scrolls; leaking one URL per
  // row would accumulate for the whole session.
  it('revokes its object URL on unmount', async () => {
    const { unmount } = render(<BubbleMedia item={media()} storageRef={storageRef} />)
    await screen.findByRole('img')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:fake')
  })
})
