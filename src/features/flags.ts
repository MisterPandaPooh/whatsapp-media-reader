// src/features/flags.ts
//
// Feature flags, read from localStorage so a feature can be switched without a
// rebuild:
//
//   localStorage.setItem('wmr.flag.occasions', 'off')   // then reload
//
// Deliberately read-once-per-call rather than cached: a flag flipped from the
// console should take effect on the next reload without any cache to clear, and
// localStorage reads are cheap enough that memoising them would be a false
// economy for the handful of call sites here.

interface Flag {
  key: string
  /** What the flag does when nobody has said otherwise. */
  default: boolean
}

/** Every flag the app knows about. */
export const FLAGS = {
  /**
   * The "Occasion" pickers in the DATE popover — Passover, Sukkot, Hanukkah,
   * Summer, Winter. On by default; set the key to `off` to hide them. The
   * occasions themselves can be replaced without a rebuild — see
   * `OCCASIONS_STORAGE_KEY`.
   */
  occasions: { key: 'wmr.flag.occasions', default: true },
} as const satisfies Record<string, Flag>

export type FlagName = keyof typeof FLAGS

/** Values that read as on, and as off. Anything else falls to the default —
 *  a typo should not silently pick a side. */
const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled'])
const FALSY = new Set(['0', 'false', 'off', 'no', 'disabled'])

export function isEnabled(flag: FlagName): boolean {
  const value = readFlag(FLAGS[flag].key)
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  return FLAGS[flag].default
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
