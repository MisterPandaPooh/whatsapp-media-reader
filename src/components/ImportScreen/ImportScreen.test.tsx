// src/components/ImportScreen/ImportScreen.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportScreen } from './ImportScreen'

afterEach(() => {
  cleanup()
})

const cancelButton = () => screen.queryByRole('button', { name: 'Cancel' })

describe('ImportScreen cancel affordance', () => {
  it('offers no way out when there is nothing to go back to', () => {
    // The first-run import screen: cancelling would leave a blank app.
    render(<ImportScreen onOpen={vi.fn()} />)

    expect(cancelButton()).toBeNull()
  })

  it('cancels back to the caller when opened over a loaded chat', () => {
    const onCancel = vi.fn()
    render(<ImportScreen onOpen={vi.fn()} onCancel={onCancel} />)

    fireEvent.click(cancelButton() as HTMLElement)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not also trigger the drop card`s file picker', () => {
    // The whole card is a click target; without stopPropagation, cancelling
    // would pop a file dialog on the way out.
    const onCancel = vi.fn()
    render(<ImportScreen onOpen={vi.fn()} onCancel={onCancel} />)
    const fileInput = document.querySelector('.import-file-input') as HTMLInputElement
    const inputClick = vi.spyOn(fileInput, 'click')

    fireEvent.click(cancelButton() as HTMLElement)

    expect(inputClick).not.toHaveBeenCalled()
  })

  it('never calls onOpen just because the screen was dismissed', () => {
    const onOpen = vi.fn()
    render(<ImportScreen onOpen={onOpen} onCancel={vi.fn()} />)

    fireEvent.click(cancelButton() as HTMLElement)

    expect(onOpen).not.toHaveBeenCalled()
  })
})

// A stand-in for the import worker: captures the instance so a test can post it
// whatever result the real one would have produced for a given export.
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor() {
    FakeWorker.last = this
  }
  postMessage(msg: unknown) {
    this.posted.push(msg)
  }
  terminate() {
    this.terminated = true
  }
}
vi.stubGlobal('Worker', FakeWorker)

function parsed(messageCount: number, mediaCount: number) {
  return {
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `msg${i}`,
      sender: 'Ana',
      timestampMs: 1700000000000 + i,
      text: `line ${i}`,
      isSystemMessage: false,
    })),
    media: Array.from({ length: mediaCount }, (_, i) => ({
      id: `m${i}`,
      kind: 'photo' as const,
      filename: `p${i}.jpg`,
      size: 1,
      caption: '',
      sender: 'Ana',
      timestampMs: 1700000000000 + i,
      anchorMessageId: `msg${i}`,
      starred: false,
      missing: false,
    })),
    participants: ['Ana'],
  }
}

/** Drops a .zip on the card and waits for the worker to be spun up. */
async function dropZip() {
  const card = document.querySelector('.import-card--drop') as HTMLElement
  fireEvent.drop(card, { dataTransfer: { files: [new File(['zip'], 'export.zip')] } })
  await waitFor(() => expect(FakeWorker.last).toBeTruthy())
}

function finishImport(messageCount: number, mediaCount: number) {
  const worker = FakeWorker.last!
  act(() => {
    worker.onmessage?.({
      data: {
        type: 'done',
        parsed: parsed(messageCount, mediaCount),
        storageRef: { kind: 'opfs', folder: 'chat-1' },
      },
    } as MessageEvent<unknown>)
  })
}

describe('an export that parses to nothing', () => {
  it('refuses the import and names the likely cause', async () => {
    // Zero parsed messages is what an unrecognized date format looks like from
    // the outside — the most likely real cause. Completing the import here
    // replaces the loaded chat with an empty reader and says nothing.
    const onOpen = vi.fn()
    render(<ImportScreen onOpen={onOpen} onCancel={vi.fn()} />)
    await dropZip()

    finishImport(0, 0)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/date format|different file/i)
    // Still on the drop screen — nothing was adopted, so the loaded chat stands.
    expect(screen.getByText('Drop your chat export here')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open media reader' })).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('treats a text-only chat as a perfectly good import', async () => {
    // Messages but no media is a legitimate export, not the failure above.
    render(<ImportScreen onOpen={vi.fn()} onCancel={vi.fn()} />)
    await dropZip()

    finishImport(3, 0)

    expect(screen.getByRole('button', { name: 'Open media reader' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('getting-the-export instructions on the drop screen', () => {
  it('tells a first-time visitor how to make the file, in order', () => {
    // Someone arriving with no export has nothing to drop. The steps are the
    // difference between a usable screen and a dead end.
    render(<ImportScreen onOpen={vi.fn()} />)

    const steps = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')

    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatch(/WhatsApp/i)
    expect(steps[0]).toMatch(/Export chat/i)
    // The media choice is the one that silently ruins an export, so it must be
    // called out rather than left to the WhatsApp defaults.
    expect(steps[1]).toMatch(/Attach media/i)
    expect(steps[2]).toMatch(/drop it above/i)
  })

  it('leaves the drawings out of the accessibility tree', () => {
    // The pictures restate the words beside them; announcing them twice would
    // just make the screen longer to listen to.
    render(<ImportScreen onOpen={vi.fn()} />)

    const arts = document.querySelectorAll('.step-art')
    expect(arts.length).toBe(3)
    for (const art of arts) expect(art.getAttribute('aria-hidden')).toBe('true')
  })

  it('links out to WhatsApp`s own help page, safely', () => {
    render(<ImportScreen onOpen={vi.fn()} />)

    const link = screen.getByRole('link', { name: /WhatsApp.+instructions/i }) as HTMLAnchorElement

    expect(link.href).toContain('faq.whatsapp.com')
    expect(link.target).toBe('_blank')
    // Opening someone else's page must not hand it a reference back to this tab.
    expect(link.rel).toContain('noopener')
  })

  it('does not pop the file picker when the help link is followed', () => {
    // Same trap as Cancel: the whole card opens a file dialog on click.
    render(<ImportScreen onOpen={vi.fn()} />)
    const fileInput = document.querySelector('.import-file-input') as HTMLInputElement
    const inputClick = vi.spyOn(fileInput, 'click')

    fireEvent.click(screen.getByRole('link', { name: /WhatsApp.+instructions/i }))

    expect(inputClick).not.toHaveBeenCalled()
  })
})

describe('browsers without the File System Access pickers', () => {
  // Safari and Firefox implement OPFS but not showOpenFilePicker /
  // showDirectoryPicker. Verified against WebKit: OPFS create, streamed write,
  // unicode names, iteration and recursive remove all behave as in Chromium,
  // both on the main thread and in a worker. So the zip import — the path
  // almost everyone takes, since WhatsApp hands you a .zip — works there, and
  // only the open-a-folder-in-place path genuinely cannot.
  const realDirPicker = window.showDirectoryPicker
  const realFilePicker = window.showOpenFilePicker

  afterEach(() => {
    if (realDirPicker) window.showDirectoryPicker = realDirPicker
    else delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    if (realFilePicker) window.showOpenFilePicker = realFilePicker
    else delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
  })

  it('still offers zip import when no picker exists', () => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    render(<ImportScreen onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Choose .zip…' })).toBeTruthy()
  })

  it('hides the folder button rather than offering one that can only fail', () => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    render(<ImportScreen onOpen={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Choose folder…' })).toBeNull()
  })

  it('offers the folder button where the picker does exist', () => {
    window.showDirectoryPicker = vi.fn() as unknown as typeof window.showDirectoryPicker
    render(<ImportScreen onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Choose folder…' })).toBeTruthy()
  })

  it('falls back to the file input when showOpenFilePicker is absent', () => {
    // Without this the primary button would be dead on Safari.
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
    render(<ImportScreen onOpen={vi.fn()} />)
    const fileInput = document.querySelector('.import-file-input') as HTMLInputElement
    const inputClick = vi.spyOn(fileInput, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Choose .zip…' }))

    expect(inputClick).toHaveBeenCalledTimes(1)
  })
})
