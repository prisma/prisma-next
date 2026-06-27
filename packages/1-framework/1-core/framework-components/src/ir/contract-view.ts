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

/** The `entries` shape of one namespace in a storage map. */
type EntriesOf<TNamespace> = TNamespace extends { readonly entries: infer E } ? E : never;

/**
 * The `namespace` accessor: every storage namespace keyed by its raw id, each
 * projected to its {@link SingleNamespaceView}. Fully qualified and
 * collision-proof — `view.namespace.<id>` reaches any namespace by id even when
 * the name collides with a contract envelope field.
 */
export type NamespaceAccessor<TNamespaces, TBuiltinKinds extends string> = {
  readonly [Ns in keyof TNamespaces]: SingleNamespaceView<
    EntriesOf<TNamespaces[Ns]>,
    TBuiltinKinds
  >;
};

/**
 * Root-promoted namespaces: each namespace name promoted to a top-level
 * accessor, EXCEPT names that collide with a contract envelope field (`keyof
 * TContract`) or with the reserved `namespace` key. Those excluded names stay
 * reachable only via {@link NamespaceAccessor}. The key-remapping `as ... ?
 * never : Ns` is what keeps the root promotion from shadowing a contract field
 * at the type level.
 */
export type PromotedNamespaces<TContract, TNamespaces, TBuiltinKinds extends string> = {
  readonly [Ns in keyof TNamespaces as Ns extends keyof TContract | 'namespace'
    ? never
    : Ns]: SingleNamespaceView<EntriesOf<TNamespaces[Ns]>, TBuiltinKinds>;
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
 * Builds the runtime accessor object for a single-namespace contract: unwraps
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

/**
 * Builds the per-namespace accessor map (`{ <nsId>: SingleNamespaceView }`) for
 * every namespace in the storage, keyed by raw namespace id.
 */
export function buildNamespaceAccessor<TAccessor>(
  storage: Storage,
  builtinKinds: readonly string[],
): TAccessor {
  const out: Record<string, unknown> = {};
  for (const [nsId, ns] of Object.entries(storage.namespaces)) {
    out[nsId] = promoteBuiltinKinds(
      blindCast<
        Readonly<Record<string, unknown>>,
        'Namespace.entries is the open ADR 224 dictionary Record<string, Record<string, unknown>>'
      >(ns.entries),
      builtinKinds,
    );
  }
  return blindCast<
    TAccessor,
    'each namespace projected to its SingleNamespaceView; keys mirror the storage namespace ids'
  >(out);
}

/**
 * Composes a contract view from the deserialized contract plus its accessors,
 * enforcing collision-safe layering so the result stays substitutable for the
 * contract:
 *
 * 1. **Contract envelope fields win at the root.** Every contract own field
 *    (`storage`, `domain`, `roots`, …) is copied first and is never overwritten.
 * 2. **`rootAccessors`** (kind-promoted slots for the single-namespace families,
 *    e.g. `collection`/`table`/`entries`) are layered next; for Postgres this is
 *    empty.
 * 3. **`namespace`** holds every namespace by id — the fully-qualified,
 *    collision-proof accessor.
 * 4. **Root-promoted namespace names** are added last, but ONLY for names not
 *    already present at the root (not a contract field, not `namespace`, not an
 *    already-promoted kind slot). A namespace named `storage` is therefore
 *    reachable only via `view.namespace.storage`, while `view.storage` stays the
 *    contract's storage.
 */
export function composeContractView<TView>(
  contract: object,
  rootAccessors: Readonly<Record<string, unknown>>,
  namespaceAccessor: Readonly<Record<string, unknown>>,
): TView {
  const root: Record<string, unknown> = { ...contract };
  for (const [key, value] of Object.entries(rootAccessors)) {
    if (!(key in root)) {
      root[key] = value;
    }
  }
  root['namespace'] = namespaceAccessor;
  for (const [nsId, nsView] of Object.entries(namespaceAccessor)) {
    if (!(nsId in root)) {
      root[nsId] = nsView;
    }
  }
  return blindCast<
    TView,
    'root carries every contract field, the kind-promoted root accessors, the namespace map, and the non-colliding promoted namespace names; the view type is the caller-supplied intersection'
  >(root);
}
