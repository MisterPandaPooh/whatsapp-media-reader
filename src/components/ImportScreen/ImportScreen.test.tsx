// src/components/ImportScreen/ImportScreen.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
