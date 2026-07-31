// src/components/ImportScreen/ImportScreen.tsx
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import type { ImportProgress, ParsedChat, StorageRef, StoredChat } from '../../types'
import type { ImportRequest, ImportResponse } from '../../worker/importWorker'
import { saveChat } from '../../storage/chatRepository'
import './ImportScreen.css'

type Screen = 'drop' | 'parsing' | 'summary'

interface Result {
  parsed: ParsedChat
  storageRef: StorageRef
  title: string
  chatId: string
}

interface Props {
  onOpen: (chat: StoredChat) => void
}

const STAGE_LABEL: Record<ImportProgress['stage'], string> = {
  reading: 'Reading export',
  extracting: 'Extracting media',
  parsing: 'Parsing messages',
}

/** OPFS directory names must not contain path separators or NUL. */
function makeChatId(title: string): string {
  const safe = title.replace(/[^\w.\- ]+/g, '_').trim() || 'chat'
  return `${safe}-${Date.now()}`
}

function titleFromZipName(name: string): string {
  return name.replace(/\.zip$/i, '')
}

export function ImportScreen({ onOpen }: Props) {
  const [screen, setScreen] = useState<Screen>('drop')
  const [progress, setProgress] = useState<ImportProgress>({ stage: 'reading', progress: 0 })
  const [result, setResult] = useState<Result | null>(null)
  const [mePick, setMePick] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  // Never leave a worker running behind us (unmount, or a second import started).
  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  function runImport(
    req: { kind: 'zip'; zipBytes: Uint8Array; title: string } | { kind: 'directory'; handle: FileSystemDirectoryHandle; title: string },
  ) {
    workerRef.current?.terminate()
    setError(null)
    setProgress({ stage: 'reading', progress: 0 })
    setScreen('parsing')

    const worker = new Worker(new URL('../../worker/importWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const chatId = makeChatId(req.title)

    const finish = () => {
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }

    worker.onmessage = (e: MessageEvent<ImportResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        setProgress(msg.progress)
      } else if (msg.type === 'done') {
        setResult({ parsed: msg.parsed, storageRef: msg.storageRef, title: req.title, chatId })
        setMePick('')
        setScreen('summary')
        finish()
      } else if (msg.type === 'error') {
        setError(msg.message)
        setScreen('drop')
        finish()
      }
    }
    worker.onerror = (e) => {
      setError(e.message || 'The import worker crashed.')
      setScreen('drop')
      finish()
    }

    const request: ImportRequest =
      req.kind === 'zip'
        ? { kind: 'zip', chatId, zipBytes: req.zipBytes }
        : { kind: 'directory', chatId, handle: req.handle }
    worker.postMessage(request)
  }

  async function importZipFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    runImport({ kind: 'zip', zipBytes: bytes, title: titleFromZipName(file.name) })
  }

  async function pickZip() {
    setError(null)
    if (typeof window.showOpenFilePicker !== 'function') {
      // Browsers without the File System Access API (e.g. Firefox) still get zip import.
      zipInputRef.current?.click()
      return
    }
    let handle: FileSystemFileHandle | undefined
    try {
      ;[handle] = await window.showOpenFilePicker({
        types: [{ description: 'WhatsApp export', accept: { 'application/zip': ['.zip'] } }],
        multiple: false,
      })
    } catch {
      return // user cancelled
    }
    if (handle) await importZipFile(await handle.getFile())
  }

  async function pickFolder() {
    setError(null)
    if (typeof window.showDirectoryPicker !== 'function') {
      setError('This browser cannot open a folder directly. Zip the export folder and drop the .zip here instead.')
      return
    }
    let dirHandle: FileSystemDirectoryHandle | undefined
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'read' })
    } catch {
      return // user cancelled
    }
    if (dirHandle) runImport({ kind: 'directory', handle: dirHandle, title: dirHandle.name })
  }

  async function onZipInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await importZipFile(file)
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.name.toLowerCase().endsWith('.zip')) {
      setError(null)
      await importZipFile(file)
    } else {
      setError('Drop a .zip export, or use "Choose folder…" to pick an unzipped export folder.')
    }
  }

  async function confirmOpen() {
    if (!result || saving) return
    setSaving(true)
    const stored: StoredChat = {
      chatId: result.chatId,
      title: result.title,
      importedAtMs: Date.now(),
      storageRef: result.storageRef,
      meParticipant: mePick || null,
      parsed: result.parsed,
      starred: {},
    }
    try {
      await saveChat(stored)
    } catch (err) {
      setSaving(false)
      setError(err instanceof Error ? err.message : String(err))
      setScreen('drop')
      return
    }
    setSaving(false)
    onOpen(stored)
  }

  if (screen === 'drop') {
    return (
      <div className="import-overlay">
        <div
          className={`import-card import-card--drop${dragging ? ' import-card--dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={pickZip}
        >
          <div className="import-title">Drop your chat export here</div>
          <div className="import-sub">
            .zip archive, or a _chat.txt with its media folder. Everything is parsed locally — nothing is uploaded.
          </div>
          <div className="import-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={(e) => {
                e.stopPropagation()
                void pickZip()
              }}
            >
              Choose .zip…
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={(e) => {
                e.stopPropagation()
                void pickFolder()
              }}
            >
              Choose folder…
            </button>
          </div>
          {error && <div className="import-error">{error}</div>}
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="import-file-input"
            onChange={onZipInputChange}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    )
  }

  if (screen === 'parsing') {
    const pct = Math.max(0, Math.min(100, Math.round(progress.progress)))
    return (
      <div className="import-overlay">
        <div className="import-card">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-label">
            {STAGE_LABEL[progress.stage]} — {pct}%
          </div>
        </div>
      </div>
    )
  }

  if (!result) return null

  const photoCount = result.parsed.media.filter((m) => m.kind === 'photo').length
  const videoCount = result.parsed.media.filter((m) => m.kind === 'video').length
  const missingCount = result.parsed.media.filter((m) => m.missing).length

  return (
    <div className="import-overlay">
      <div className="import-card summary-card">
        <div className="import-title">{result.title}</div>
        <div className="import-sub">
          {result.parsed.messages.length.toLocaleString()} messages · {result.parsed.media.length.toLocaleString()} media items ·{' '}
          {photoCount.toLocaleString()} photos · {videoCount.toLocaleString()} videos
          {missingCount > 0 ? ` · ${missingCount.toLocaleString()} files missing` : ''}
        </div>
        <label className="me-picker">
          Which participant are you?
          <select value={mePick} onChange={(e) => setMePick(e.target.value)}>
            <option value="">— none —</option>
            {result.parsed.participants.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <div className="summary-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setResult(null)
              setError(null)
              setScreen('drop')
            }}
          >
            Import another
          </button>
          <button type="button" className="btn-primary" onClick={confirmOpen} disabled={saving}>
            {saving ? 'Saving…' : 'Open media reader'}
          </button>
        </div>
      </div>
    </div>
  )
}
