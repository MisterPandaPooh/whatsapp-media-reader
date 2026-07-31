// src/components/Toolbar/Toolbar.tsx
import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import type { MediaItem, MediaKind } from '../../types'
import './Toolbar.css'

const TYPES: { kind: MediaKind; label: string }[] = [
  { kind: 'photo', label: 'Photos' },
  { kind: 'video', label: 'Videos' },
  { kind: 'doc', label: 'Docs' },
  { kind: 'voice', label: 'Voice' },
  { kind: 'link', label: 'Links' },
]

const PRESETS = ['All time', 'Last 7 days', 'Last 30 days', 'This month'] as const
type Preset = (typeof PRESETS)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function endOfDay(ms: number): number {
  return startOfDay(ms) + DAY_MS - 1
}

function startOfMonth(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

function addMonths(ms: number, delta: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime()
}

interface Props {
  media: MediaItem[]
  resultCount: number
}

export function Toolbar({ media, resultCount }: Props) {
  const filters = useChatStore((s) => s.filters)
  const setFilters = useChatStore((s) => s.setFilters)
  const resetFilters = useChatStore((s) => s.resetFilters)

  const [senderOpen, setSenderOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [senderQuery, setSenderQuery] = useState('')
  // First click of a two-click calendar range selection.
  const [pendingStart, setPendingStart] = useState<number | null>(null)

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of media) counts[m.kind] = (counts[m.kind] ?? 0) + 1
    return counts
  }, [media])

  const starredCount = useMemo(() => media.reduce((n, m) => n + (m.starred ? 1 : 0), 0), [media])

  const senderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of media) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [media])

  const maxSenderCount = senderCounts.length > 0 ? senderCounts[0][1] : 0

  const visibleSenders = useMemo(() => {
    const q = senderQuery.trim().toLowerCase()
    if (!q) return senderCounts
    return senderCounts.filter(([name]) => name.toLowerCase().includes(q))
  }, [senderCounts, senderQuery])

  // The export is historical data: anchoring "last N days" to Date.now() would
  // yield zero results for any chat older than a month. Anchor to the newest
  // item in the export instead, and label each preset with the dates it resolves to.
  const { minMs, maxMs } = useMemo(() => {
    if (media.length === 0) {
      const now = Date.now()
      return { minMs: now, maxMs: now }
    }
    let min = Infinity
    let max = -Infinity
    for (const m of media) {
      if (m.timestampMs < min) min = m.timestampMs
      if (m.timestampMs > max) max = m.timestampMs
    }
    return { minMs: min, maxMs: max }
  }, [media])

  const dayCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const m of media) {
      const key = startOfDay(m.timestampMs)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [media])

  const maxDayCount = useMemo(() => {
    let max = 0
    for (const n of dayCounts.values()) if (n > max) max = n
    return max
  }, [dayCounts])

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(maxMs))
  // Re-centre the calendar when a different chat (different date range) is loaded.
  useEffect(() => {
    setViewMonth(startOfMonth(maxMs))
  }, [maxMs])

  useEffect(() => {
    if (!senderOpen && !dateOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSenderOpen(false)
        setDateOpen(false)
        setPendingStart(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [senderOpen, dateOpen])

  function closePopovers() {
    setSenderOpen(false)
    setDateOpen(false)
    setPendingStart(null)
  }

  // Read the live store value rather than the render closure, so two clicks
  // landing before a re-render can't compute their `next` array from stale state.
  function toggleType(kind: MediaKind) {
    const current = useChatStore.getState().filters.types
    setFilters({ types: current.includes(kind) ? current.filter((t) => t !== kind) : [...current, kind] })
  }

  function toggleSender(name: string) {
    const current = useChatStore.getState().filters.senders
    setFilters({ senders: current.includes(name) ? current.filter((s) => s !== name) : [...current, name] })
  }

  function presetRange(preset: Preset): { dateFrom: number | null; dateTo: number | null } {
    if (preset === 'All time') return { dateFrom: null, dateTo: null }
    if (preset === 'Last 7 days') return { dateFrom: startOfDay(maxMs - 6 * DAY_MS), dateTo: endOfDay(maxMs) }
    if (preset === 'Last 30 days') return { dateFrom: startOfDay(maxMs - 29 * DAY_MS), dateTo: endOfDay(maxMs) }
    return { dateFrom: startOfMonth(maxMs), dateTo: endOfDay(maxMs) }
  }

  function applyPreset(preset: Preset) {
    setFilters(presetRange(preset))
    setPendingStart(null)
    setDateOpen(false)
  }

  function pickDay(dayStart: number) {
    if (pendingStart === null) {
      setPendingStart(dayStart)
      setFilters({ dateFrom: dayStart, dateTo: dayStart + DAY_MS - 1 })
      return
    }
    if (dayStart >= pendingStart) setFilters({ dateFrom: pendingStart, dateTo: dayStart + DAY_MS - 1 })
    else setFilters({ dateFrom: dayStart, dateTo: pendingStart + DAY_MS - 1 })
    setPendingStart(null)
  }

  const calendarDays = useMemo(() => {
    const view = new Date(viewMonth)
    const year = view.getFullYear()
    const month = view.getMonth()
    const leading = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < leading; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d).getTime())
    return cells
  }, [viewMonth])

  const canPrevMonth = viewMonth > startOfMonth(minMs)
  const canNextMonth = viewMonth < startOfMonth(maxMs)

  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p)
    return r.dateFrom === filters.dateFrom && r.dateTo === filters.dateTo
  })

  const dateLabel =
    filters.dateFrom === null && filters.dateTo === null
      ? 'Any time'
      : activePreset && activePreset !== 'All time'
        ? activePreset
        : `${filters.dateFrom !== null ? shortDate.format(filters.dateFrom) : '…'} – ${
            filters.dateTo !== null ? shortDate.format(filters.dateTo) : '…'
          }`

  const anyFilter =
    filters.types.length > 0 ||
    filters.senders.length > 0 ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.starredOnly ||
    filters.query !== ''

  return (
    <div className="toolbar">
      {(senderOpen || dateOpen) && (
        <div className="popover-overlay" onClick={closePopovers} aria-hidden="true" />
      )}

      <div className="type-chips" role="group" aria-label="Filter by media type">
        {TYPES.map(({ kind, label }) => {
          const active = filters.types.includes(kind)
          return (
            <button
              key={kind}
              type="button"
              className={`chip ${active ? 'chip--active' : ''}`}
              aria-pressed={active}
              onClick={() => toggleType(kind)}
            >
              {label} <span className="chip-count">{typeCounts[kind] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <div className="divider" />

      <div className="popover-anchor">
        <button
          type="button"
          className={`chip chip--standalone ${filters.senders.length > 0 ? 'chip--active' : ''}`}
          aria-expanded={senderOpen}
          aria-haspopup="dialog"
          onClick={() => {
            setDateOpen(false)
            // The in-popover search is transient UI state, not a filter: start fresh
            // each time it opens so the list never looks mysteriously empty.
            setSenderQuery('')
            setSenderOpen((v) => !v)
          }}
        >
          <span className="chip-key">FROM</span>
          {filters.senders.length === 0
            ? 'Anyone'
            : filters.senders.length === 1
              ? filters.senders[0]
              : `${filters.senders.length} people`}
        </button>
        {senderOpen && (
          <div className="popover popover--senders" role="dialog" aria-label="Filter by sender">
            <input
              className="popover-search"
              placeholder="Search people"
              value={senderQuery}
              autoFocus
              onChange={(e) => setSenderQuery(e.target.value)}
            />
            <div className="popover-list">
              {visibleSenders.length === 0 && <div className="popover-empty">No matching people</div>}
              {visibleSenders.map(([name, count]) => {
                const on = filters.senders.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    className="popover-row"
                    aria-pressed={on}
                    onClick={() => toggleSender(name)}
                  >
                    <span className={`checkbox ${on ? 'checkbox--on' : ''}`} />
                    <span className="popover-name">{name}</span>
                    <span className="volume-bar">
                      <span
                        className="volume-bar-fill"
                        style={{ width: `${maxSenderCount > 0 ? (count / maxSenderCount) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="popover-count">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="popover-footer">
              <button type="button" onClick={() => setFilters({ senders: senderCounts.map(([n]) => n) })}>
                All
              </button>
              <button type="button" onClick={() => setFilters({ senders: [] })}>
                None
              </button>
              <button type="button" className="popover-done" onClick={() => setSenderOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="popover-anchor">
        <button
          type="button"
          className={`chip chip--standalone ${filters.dateFrom !== null || filters.dateTo !== null ? 'chip--active' : ''}`}
          aria-expanded={dateOpen}
          aria-haspopup="dialog"
          onClick={() => {
            setSenderOpen(false)
            setDateOpen((v) => !v)
          }}
        >
          <span className="chip-key">DATE</span>
          {dateLabel}
        </button>
        {dateOpen && (
          <div className="popover popover--date" role="dialog" aria-label="Filter by date">
            <div className="popover-list">
              {PRESETS.map((p) => {
                const r = presetRange(p)
                return (
                  <button
                    key={p}
                    type="button"
                    className={`popover-row ${activePreset === p ? 'popover-row--active' : ''}`}
                    onClick={() => applyPreset(p)}
                  >
                    <span className="popover-name">{p}</span>
                    <span className="popover-count">
                      {r.dateFrom === null
                        ? `${shortDate.format(minMs)} – ${shortDate.format(maxMs)}`
                        : `${shortDate.format(r.dateFrom)} – ${shortDate.format(r.dateTo as number)}`}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="calendar">
              <div className="calendar-head">
                <button
                  type="button"
                  className="calendar-nav"
                  disabled={!canPrevMonth}
                  aria-label="Previous month"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                >
                  ‹
                </button>
                <span className="calendar-month">{monthLabel.format(viewMonth)}</span>
                <button
                  type="button"
                  className="calendar-nav"
                  disabled={!canNextMonth}
                  aria-label="Next month"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                >
                  ›
                </button>
              </div>
              <div className="calendar-grid">
                {WEEKDAYS.map((w, i) => (
                  <span key={i} className="calendar-weekday">
                    {w}
                  </span>
                ))}
                {calendarDays.map((dayStart, i) => {
                  if (dayStart === null) return <span key={`b${i}`} className="calendar-cell calendar-cell--blank" />
                  const count = dayCounts.get(dayStart) ?? 0
                  const inRange =
                    filters.dateFrom !== null &&
                    filters.dateTo !== null &&
                    dayStart >= startOfDay(filters.dateFrom) &&
                    dayStart <= filters.dateTo
                  const isPending = pendingStart === dayStart
                  return (
                    <button
                      key={dayStart}
                      type="button"
                      className={`calendar-cell ${inRange ? 'calendar-cell--in-range' : ''} ${
                        isPending ? 'calendar-cell--pending' : ''
                      }`}
                      onClick={() => pickDay(dayStart)}
                      title={`${shortDate.format(dayStart)} — ${count} item${count === 1 ? '' : 's'}`}
                    >
                      {new Date(dayStart).getDate()}
                      <span
                        className="calendar-dot"
                        style={{
                          opacity: count === 0 ? 0 : 0.35 + 0.65 * (count / (maxDayCount || 1)),
                        }}
                      />
                    </button>
                  )
                })}
              </div>
              <div className="calendar-hint">
                {pendingStart !== null ? 'Pick the end of the range' : 'Click a day, then another, to set a range'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="divider" />

      <button
        type="button"
        className={`chip chip--standalone ${filters.starredOnly ? 'chip--active' : ''}`}
        aria-pressed={filters.starredOnly}
        onClick={() => setFilters({ starredOnly: !filters.starredOnly })}
      >
        ★ Starred <span className="chip-count">{starredCount}</span>
      </button>

      <input
        className="search-box"
        type="search"
        aria-label="Search messages, captions, filenames"
        placeholder="Search messages, captions, filenames"
        value={filters.query}
        onChange={(e) => setFilters({ query: e.target.value })}
      />

      <div className="result-count">{resultCount} results</div>

      {anyFilter && (
        <button type="button" className="reset-btn" onClick={resetFilters}>
          Reset filters
        </button>
      )}
    </div>
  )
}
