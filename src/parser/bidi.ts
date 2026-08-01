// src/parser/bidi.ts
//
// WhatsApp wraps generated fragments in bidirectional format characters so they
// render correctly next to right-to-left text. They are invisible, but they are
// still characters: left in a sender name they end up inside participant lists,
// filter chips and the "which of these is me?" comparison, where two spellings
// of the same person would not match.

/** LRM, RLM, the embedding/override block, and the isolate block. */
const BIDI_FORMAT = /[‎‏‪-‮⁦-⁩]/g

/**
 * For a sender name. A phone number with no contact entry is exported as
 * `‪+1 (212) 555-0142‬`, and those two invisible characters would
 * otherwise become part of the participant's identity.
 */
export function stripBidiFormatting(name: string): string {
  return name.replace(BIDI_FORMAT, '').trim()
}

/**
 * For message text, where the marks are not all noise — one inside a sentence
 * may be doing real work for a right-to-left reader. Only the isolates WhatsApp
 * puts around an @mention are removed, so `@⁨Nina Duval⁩` reads as
 * `@Nina Duval` rather than as a name with two invisible characters glued to it
 * (which is also what the free-text search would otherwise have to match).
 */
export function stripMentionIsolates(text: string): string {
  return text.replace(/@⁨([^⁩]*)⁩/g, '@$1')
}
