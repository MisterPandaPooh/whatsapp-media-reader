/**
 * Stamped onto every chat written to IndexedDB, and compared against the stored
 * value on load: a mismatch means the record was produced by a parser that has
 * since been corrected, and the chat is silently re-parsed from its transcript
 * before it is shown.
 *
 * This exists because parsing happens exactly once, at import. Every parser fix
 * shipped so far therefore reached only *new* imports — an already-loaded chat
 * kept rendering the old, wrong result on every reload, and the only cure was
 * for the user to know to import the export again. Two ad-hoc repairs in
 * `chatRepository` (marker stripping, starred-flag reconciliation) were built to
 * patch stored records field by field for exactly this reason; they cannot fix a
 * record whose *message boundaries* are wrong, which is what the U+200E bug did.
 *
 * Bump this whenever a change to the parser would make it produce different
 * output for the same transcript.
 *
 * 1 — original.
 * 2 — leading bidi marks (U+200E) stripped before matching the date prefix.
 *     Before this, every iOS attachment line was folded into the preceding
 *     message: message boundaries, media count and media *sender* were all wrong.
 */
export const PARSER_VERSION = 2
