// src/components/Toolbar/Toolbar.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { Popover } from './Popover'
import type { MediaItem, MediaKind } from '../../types'
import {
  PRESETS,
  addMonths,
  presetRange,
  rangeBetween,
  startOfDay,
  startOfMonth,
  type Preset,
} from './dateRange'
import { eventLabel, eventSpans, eventYears, quickEvents } from './quickEvents'
import { isEnabled } from '../../features/flags'
import './Toolbar.css'

const TYPES: { kind: MediaKind; label: string }[] = [
  { kind: 'photo', label: 'Photos' },
  { kind: 'video', label: 'Videos' },
  { kind: 'doc', label: 'Docs' },
  { kind: 'voice', label: 'Voice' },
  { kind: 'link', label: 'Links' },
]

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

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
  // The popovers render in a portal, so their placement is computed from these.
  const senderBtnRef = useRef<HTMLButtonElement>(null)
  const dateBtnRef = useRef<HTMLButtonElement>(null)
  const [senderQuery, setSenderQuery] = useState('')
  // First click of a two-click calendar range selection.
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  // Which quick event the two selects are showing. Mirrors the filter rather
  // than owning it: Reset clears the filter, and this follows via the effect below.
  const [eventId, setEventId] = useState('')
  const [eventYear, setEventYear] = useState<number | 'all'>('all')
  // Off unless the flag is set. Read once per mount rather than per render: the
  // flag and the list it drives are console-edited settings, and re-reading
  // localStorage on every keystroke in the search box would be pure waste. Both
  // take effect on the next reload, which is also when the reader would look.
  const [occasionsOn] = useState(() => isEnabled('occasions'))
  const [occasions] = useState(() => (isEnabled('occasions') ? quickEvents() : []))
  const [years] = useState(() => (isEnabled('occasions') ? eventYears() : []))

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

  // "Reset filters" clears the store but cannot reach this component's local
  // selects, which would then still read "Pessah" over an unfiltered grid.
  useEffect(() => {
    if (filters.dateSpans.length === 0) setEventId('')
  }, [filters.dateSpans])

  useEffect(() => {
    if (!senderOpen && !dateOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSenderOpen(false)
        setDateOpen(false)
        setPendingStart(null)
        // Marks the keypress as consumed for the app-level handler, which would
        // otherwise close the detail panel with the same Escape. Capture phase
        // guarantees this runs first: on `window`, capture always precedes the
        // bubble listener the app shell registers, whatever the mount order.
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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

  function toggleStarredOnly() {
    setFilters({ starredOnly: !useChatStore.getState().filters.starredOnly })
  }

  // Anchored to the newest item in the export rather than Date.now(); see dateRange.ts.
  const rangeFor = (preset: Preset) => presetRange(preset, maxMs)

  function applyPreset(preset: Preset) {
    // Clearing the spans is what makes the two date modes alternatives rather
    // than a confusing intersection.
    setFilters({ ...rangeFor(preset), dateSpans: [] })
    setPendingStart(null)
    setEventId('')
    setDateOpen(false)
  }

  function applyEvent(id: string, year: number | 'all') {
    if (!id) {
      setFilters({ dateSpans: [], dateFrom: null, dateTo: null })
      return
    }
    setFilters({ dateSpans: eventSpans(id, year), dateFrom: null, dateTo: null })
    setPendingStart(null)
  }

  function pickDay(dayStart: number) {
    if (pendingStart === null) {
      setPendingStart(dayStart)
      setEventId('')
      setFilters({ ...rangeBetween(dayStart, dayStart), dateSpans: [] })
      return
    }
    setEventId('')
    setFilters({ ...rangeBetween(pendingStart, dayStart), dateSpans: [] })
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
    const r = rangeFor(p)
    return r.dateFrom === filters.dateFrom && r.dateTo === filters.dateTo
  })

  const dateLabel = filters.dateSpans.length
    ? eventLabel(eventId, eventYear)
    : filters.dateFrom === null && filters.dateTo === null
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
    filters.dateSpans.length > 0 ||
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
          ref={senderBtnRef}
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
          <Popover anchorRef={senderBtnRef} className="popover popover--senders" label="Filter by sender">
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
          </Popover>
        )}
      </div>

      <div className="divider" />

      <div className="popover-anchor">
        <button
          ref={dateBtnRef}
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
          <Popover anchorRef={dateBtnRef} className="popover popover--date" label="Filter by date">
            <div className="popover-list">
              {PRESETS.map((p) => {
                const r = rangeFor(p)
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

            {occasionsOn && (
            <div className="quick-events">
              <label className="quick-event-field">
                <span className="quick-event-label">Occasion</span>
                <select
                  className="quick-event-select"
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value)
                    applyEvent(e.target.value, eventYear)
                  }}
                >
                  <option value="">—</option>
                  {occasions.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="quick-event-field">
                <span className="quick-event-label">Année</span>
                <select
                  className="quick-event-select"
                  value={String(eventYear)}
                  disabled={!eventId}
                  onChange={(e) => {
                    const y = e.target.value === 'all' ? 'all' : Number(e.target.value)
                    setEventYear(y)
                    if (eventId) applyEvent(eventId, y)
                  }}
                >
                  <option value="all">Toutes</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              {filters.dateSpans.length > 0 && (
                <span className="quick-event-hint">
                  {filters.dateSpans.length} période{filters.dateSpans.length > 1 ? 's' : ''} · {resultCount} résultat
                  {resultCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            )}

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
          </Popover>
        )}
      </div>

      <div className="divider" />

      <button
        type="button"
        className={`chip chip--standalone ${filters.starredOnly ? 'chip--active' : ''}`}
        aria-pressed={filters.starredOnly}
        onClick={toggleStarredOnly}
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

      <div className="result-count">
        {resultCount.toLocaleString()} {resultCount === 1 ? 'result' : 'results'}
      </div>

      {anyFilter && (
        <button type="button" className="reset-btn" onClick={resetFilters}>
          Reset filters
        </button>
      )}
    </div>
  )
}
