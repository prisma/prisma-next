import { blindCast } from '@prisma-next/utils/casts';
import { UNBOUND_NAMESPACE_ID } from './namespace';
import type { Storage } from './storage';

/**
 * Extracts the entries map of a contract's single default namespace
 * (`UNBOUND_NAMESPACE_ID`). Both single-namespace families (Mongo, SQLite)
 * store all entities under this one namespace.
 */
export type DefaultNamespaceEntries<TStorage extends { readonly namespaces: object }> =
  TStorage['namespaces'] extends Record<typeof UNBOUND_NAMESPACE_ID, { readonly entries: infer E }>
    ? E
    : never;

/**
 * Generic single-namespace projection shape. A family supplies:
 *  - `TEntries` — the family's `*NamespaceEntries` type for the default namespace.
 *  - `TBuiltinKinds` — the union of the family's statically-named built-in kind
 *    keys (Mongo `'collection'`; SQL `'table' | 'valueSet'`).
 *
 * Each built-in kind becomes a top-level accessor; the remaining pack-contributed
 * kinds stay under `.entries` (keyed by their registered singular kind string).
 *
 * A built-in kind that the emitted contract does not carry resolves to an empty
 * map (`Record<string, never>`), matching the runtime which always materializes
 * each built-in slot. The `& string` index-signature member of `TEntries` is
 * excluded from `.entries` so only the literal pack-kind keys remain.
 */
export type SingleNamespaceView<TEntries, TBuiltinKinds extends string> = {
  readonly [K in TBuiltinKinds]-?: K extends keyof TEntries
    ? NonNullable<TEntries[K]>
    : Record<string, never>;
} & {
  readonly entries: {
    readonly [K in Exclude<keyof TEntries, TBuiltinKinds | number | symbol> as string extends K
      ? never
      : K]: TEntries[K];
  };
};

/**
 * Projects one namespace's `entries` into the view shape: each built-in kind
 * becomes a top-level slot (materialized empty if absent), and the remaining
 * pack-contributed kinds sit under `.entries`. Shared by the single-namespace
 * builder and the per-schema (multi-namespace) Postgres builder.
 */
export function promoteBuiltinKinds<TView>(
  entries: Readonly<Record<string, unknown>>,
  builtinKinds: readonly string[],
): TView {
  const view: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [kind, kindMap] of Object.entries(entries)) {
    if (builtinKinds.includes(kind)) {
      view[kind] = kindMap;
    } else {
      rest[kind] = kindMap;
    }
  }
  for (const kind of builtinKinds) {
    if (!(kind in view)) {
      view[kind] = {};
    }
  }
  view['entries'] = rest;
  return blindCast<TView, 'view is built to the SingleNamespaceView shape the caller parametrizes'>(
    view,
  );
}

/**
 * Builds the runtime projection object for a single-namespace contract: unwraps
 * the default namespace and promotes the given built-in kind slots to top-level.
 * The static type is supplied by the caller via the generic factory; this
 * function is structural.
 *
 * Throws if the contract has no default (`UNBOUND_NAMESPACE_ID`) namespace.
 */
export function buildSingleNamespaceView<TView>(
  storage: Storage,
  builtinKinds: readonly string[],
): TView {
  const defaultNs = storage.namespaces[UNBOUND_NAMESPACE_ID];
  if (defaultNs === undefined) {
    throw new Error(`ContractView: contract has no default namespace (${UNBOUND_NAMESPACE_ID})`);
  }
  const entries = blindCast<
    Record<string, unknown>,
    'Namespace.entries is the open ADR 224 dictionary Record<string, Record<string, unknown>>'
  >(defaultNs.entries);
  return promoteBuiltinKinds<TView>(entries, builtinKinds);
}
