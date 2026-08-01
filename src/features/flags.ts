// src/features/flags.ts
//
// Feature flags, read from localStorage so a feature can be switched on in a
// browser without a rebuild:
//
//   localStorage.setItem('wmr.flag.occasions', 'on')   // then reload
//
// Deliberately read-once-per-call rather than cached: a flag flipped from the
// console should take effect on the next reload without any cache to clear, and
// localStorage reads are cheap enough that memoising them would be a false
// economy for the handful of call sites here.

/** Every flag the app knows about, and what switching it on does. */
export const FLAGS = {
  /**
   * The "Occasion" pickers in the DATE popover — Pessah, Souccot, Hanouka, Été,
   * Hiver. Off by default: the holiday table is specific to one family's
   * calendar, so it is opt-in rather than something every reader shows.
   * The occasions themselves can be replaced without a rebuild too — see
   * `OCCASIONS_STORAGE_KEY`.
   */
  occasions: 'wmr.flag.occasions',
} as const

export type FlagName = keyof typeof FLAGS

/** Values that read as "on". Anything else — including absent — is off. */
const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled'])

export function isEnabled(flag: FlagName): boolean {
  return TRUTHY.has(readFlag(FLAGS[flag]))
}

function readFlag(key: string): string {
  try {
    return (localStorage.getItem(key) ?? '').trim().toLowerCase()
  } catch {
    // Storage can throw outright: Safari in private mode, or a page whose
    // origin has cookies blocked. A flag nobody can read is simply off.
    return ''
  }
}
