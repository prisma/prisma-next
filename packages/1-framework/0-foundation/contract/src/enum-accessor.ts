import type { Contract } from './contract-types';
import type { ContractEnum } from './domain-types';
import type { JsonValue } from './types';

/**
 * Runtime view of a domain enum, built at the client from the emitted
 * `ContractEnum` JSON (codec-encoded `JsonValue` members, literal types erased).
 *
 * This deliberately mirrors the accessor shape of the authoring-time
 * `EnumTypeHandle` (in `contract-ts`) rather than reusing it: that handle carries
 * the literal value generics and lives in the authoring layer, which the
 * foundation layer cannot depend on. The two are the same surface seen from the
 * two planes — authoring (typed) and runtime (validated JSON).
 */
export interface EnumAccessor {
  readonly values: readonly JsonValue[];
  readonly names: readonly string[];
  readonly members: Readonly<Record<string, JsonValue>>;
  has(v: JsonValue): boolean;
  hasName(name: string): boolean;
  nameOf(v: JsonValue): string | undefined;
  ordinalOf(v: JsonValue): number;
}

export function createEnumAccessor(contractEnum: ContractEnum): EnumAccessor {
  const values = Object.freeze(contractEnum.members.map((m) => m.value));
  const names = Object.freeze(contractEnum.members.map((m) => m.name));
  const members: Readonly<Record<string, JsonValue>> = Object.freeze(
    Object.fromEntries(contractEnum.members.map((m) => [m.name, m.value])),
  );

  const valueSet = new Set(values);
  const nameSet = Object.freeze(new Set(names));
  const valueToName = new Map(contractEnum.members.map((m) => [m.value, m.name]));
  const valueToOrdinal = new Map(values.map((v, i) => [v, i]));

  return {
    values,
    names,
    members,
    has: (v: JsonValue) => valueSet.has(v),
    hasName: (name: string) => nameSet.has(name),
    nameOf: (v: JsonValue) => valueToName.get(v),
    ordinalOf: (v: JsonValue) => valueToOrdinal.get(v) ?? -1,
  };
}

/**
 * Build the enum-accessor map for a single namespace, keyed by enum name.
 * Each namespace facet exposes only its own enums — the IR keys enums under
 * `domain.namespaces[ns].enum`, so the same name in two namespaces resolves
 * independently rather than colliding in one flat map.
 */
export function buildEnumsMapForNamespace(
  domain: {
    readonly namespaces: Readonly<
      Record<string, { readonly enum?: Readonly<Record<string, ContractEnum>> }>
    >;
  },
  namespaceId: string,
): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  const namespace = domain.namespaces[namespaceId];
  if (namespace?.enum) {
    for (const [name, contractEnum] of Object.entries(namespace.enum)) {
      result[name] = createEnumAccessor(contractEnum);
    }
  }
  return result;
}

/**
 * Build the enum-accessor map for every namespace of a domain, keyed by
 * namespace id then enum name. This is the lane-agnostic enum surface the
 * `db.enums` facade member exposes: enums are contract metadata, the same
 * whether reached through the sql lane or the orm lane, so the facade builds
 * this once and projects it per target.
 */
export function buildNamespacedEnums(domain: {
  readonly namespaces: Readonly<
    Record<string, { readonly enum?: Readonly<Record<string, ContractEnum>> }>
  >;
}): Record<string, Record<string, EnumAccessor>> {
  const result: Record<string, Record<string, EnumAccessor>> = {};
  for (const namespaceId of Object.keys(domain.namespaces)) {
    result[namespaceId] = buildEnumsMapForNamespace(domain, namespaceId);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Type-level projection of the namespaced enum surface.
//
// These types derive the literal-preserving accessor shape from the contract,
// hung off the `db.enums` facade map (`db.enums.<ns>.<Name>`). They are the
// same accessors the runtime builds above, but typed from the two emission
// paths:
//   - Emitted contracts carry the literal enum entries under
//     `domain.namespaces[ns].enum`; each maps to a `ContractEnumAccessor`.
//   - The no-emit (built) contract carries them flat on `enumAccessors`
//     (already accessor-shaped, literal-preserving), since its built domain
//     type does not narrow `namespaces[ns].enum`. All authored enums land in
//     the single built namespace, so exposing the flat map per namespace is
//     correct there.
// Only `SqlContractResult` carries `enumAccessors`; emitted contracts never
// do, so the two carriers never overlap.
// ---------------------------------------------------------------------------

type Present<T> = Exclude<T, undefined>;

// A domain enum entry as carried in `domain.namespaces[ns].enum[name]`: an
// ordered member tuple. The no-emit (built) path preserves the literal member
// values so the derived accessor keeps its literal `values`/`names`/`members`.
type EnumMemberEntry = { readonly name: string; readonly value: JsonValue };
type EnumEntry = { readonly members: readonly EnumMemberEntry[] };

type EnumEntryValues<Entry extends EnumEntry> = {
  readonly [I in keyof Entry['members']]: Entry['members'][I] extends EnumMemberEntry
    ? Entry['members'][I]['value']
    : never;
};

type EnumEntryNames<Entry extends EnumEntry> = {
  readonly [I in keyof Entry['members']]: Entry['members'][I] extends EnumMemberEntry
    ? Entry['members'][I]['name']
    : never;
};

type EnumEntryMembers<Entry extends EnumEntry> = {
  readonly [M in Entry['members'][number] as M['name']]: M['value'];
};

// The runtime accessor shape for one enum, with literal `values`/`names`/
// `members` derived from the entry's member tuple. Mirrors `EnumAccessor`'s
// runtime surface and the authoring `EnumTypeHandle` accessor.
export type ContractEnumAccessor<Entry extends EnumEntry> = {
  readonly values: EnumEntryValues<Entry>;
  readonly names: EnumEntryNames<Entry>;
  readonly members: EnumEntryMembers<Entry>;
  /** Returns true and narrows `v` to the enum's value union when `v` is a declared member value. */
  has(v: JsonValue): v is EnumEntryValues<Entry>[number];
  /** Returns true and narrows `name` to the enum's member-name union when `name` is a declared member name. */
  hasName(name: string): name is Extract<EnumEntryNames<Entry>[number], string>;
  nameOf(v: EnumEntryValues<Entry>[number]): string | undefined;
  ordinalOf(v: EnumEntryValues<Entry>[number]): number;
};

/**
 * The value union for a `ContractEnumAccessor`.
 * Use in function signatures to accept any declared enum value without re-exporting
 * the member type alias from the accessor's generic entry.
 */
export type EnumValues<A> = A extends { readonly values: ReadonlyArray<infer V> } ? V : never;

/**
 * The member-name union for a `ContractEnumAccessor`.
 */
export type EnumMemberNames<A> = A extends { readonly names: ReadonlyArray<infer N> } ? N : never;

type EnumEntriesToAccessors<Enums> = {
  readonly [K in keyof Enums]: Enums[K] extends EnumEntry ? ContractEnumAccessor<Enums[K]> : never;
};

type BuiltEnumAccessorsOf<TContract> = TContract extends {
  readonly enumAccessors: infer A;
}
  ? A
  : Record<never, never>;

type NamespaceEnumEntries<TNamespace> = TNamespace extends {
  readonly enum?: infer E;
}
  ? unknown extends E
    ? Record<never, never>
    : Present<E>
  : Record<never, never>;

// The per-namespace enum accessors. Each namespace exposes only its own enums
// (the IR's `domain.namespaces[ns].enum`), so the same enum name in two
// namespaces resolves to each namespace's own accessor.
export type NamespaceEnumAccessors<
  TContract extends Contract,
  NsId extends keyof TContract['domain']['namespaces'],
> = EnumEntriesToAccessors<NamespaceEnumEntries<TContract['domain']['namespaces'][NsId]>> &
  BuiltEnumAccessorsOf<TContract>;

// The lane-agnostic enum surface exposed on the `db.enums` facade member: a
// namespace-keyed map projected per target exactly like `db.sql` / `db.orm`.
export type NamespacedEnums<TContract extends Contract> = {
  readonly [Ns in keyof TContract['domain']['namespaces']]: NamespaceEnumAccessors<TContract, Ns>;
};
