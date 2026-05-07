/**
 * Local `JsonValue` alias for the SQLite target. Class-form codec
 * implementations live in `codecs-class.ts` (TML-2357 M0 Phase B3/C); this
 * module retains only the JSON-shape alias the surrounding adapter and
 * tests still import.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
