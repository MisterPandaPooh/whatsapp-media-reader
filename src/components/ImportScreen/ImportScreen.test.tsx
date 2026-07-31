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
