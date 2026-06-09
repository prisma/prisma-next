import type { ColumnTypeDescriptor } from '@prisma-next/framework-components/codec';
import { blindCast } from '@prisma-next/utils/casts';

// ---------------------------------------------------------------------------
// EnumMember — a single member declaration with literal type preservation
// ---------------------------------------------------------------------------

/**
 * A single enum member produced by `member()`. The `Name` and `Value` generics
 * are preserved as literal types so `enumType()` can carry the ordered value
 * tuple in its return type. `Value` is whatever the codec dictates — its type
 * is constrained at `enumType` against the codec's input type, not here.
 */
export interface EnumMember<Name extends string, Value> {
  readonly name: Name;
  readonly value: Value;
}

/**
 * Declare an enum member. The `value` defaults to `name` when omitted. The
 * value is an unconstrained literal here; `enumType` constrains it against the
 * codec's input type. Both generics are preserved as literals so downstream
 * `enumType` carries the value union in its type; the value is serialized to its
 * codec string form only at lowering.
 */
export function member<const Name extends string>(name: Name): EnumMember<Name, Name>;
export function member<const Name extends string, const Value>(
  name: Name,
  value: Value,
): EnumMember<Name, Value>;
export function member<const Name extends string, const Value = Name>(
  name: Name,
  value?: Value,
): EnumMember<Name, Value> {
  return {
    name,
    value: blindCast<
      Value,
      'overload signatures enforce Value=Name when value is omitted; default generic Value=Name makes this safe'
    >(value ?? name),
  };
}

// ---------------------------------------------------------------------------
// Internal types for inferring the literal tuple from the members spread
// ---------------------------------------------------------------------------

type MembersToValues<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [K in keyof Members]: Members[K] extends EnumMember<string, infer V> ? V : never;
};

type MembersToNames<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [K in keyof Members]: Members[K] extends EnumMember<infer N, unknown> ? N : never;
};

type MembersAccessorMap<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [M in Members[number] as M['name']]: M['value'];
};

// ---------------------------------------------------------------------------
// EnumTypeHandle — the authoring handle returned by enumType()
// ---------------------------------------------------------------------------

/**
 * Internal brand that identifies an EnumTypeHandle in the lowering pipeline.
 * Not exported — callers only interact with `EnumTypeHandle`.
 */
export const ENUM_TYPE_HANDLE_BRAND = Symbol('EnumTypeHandle');

/**
 * Authoring handle returned by `enumType()`. Carries:
 *
 * - The ordered literal value tuple (`.values`) and name tuple (`.names`)
 *   so downstream type-tests can assert literal preservation.
 * - A namespaced member accessor map (`.members`) to avoid collisions with
 *   `.values` / `.has` / `.nameOf` / `.ordinalOf`.
 * - Runtime helpers `.has()`, `.nameOf()`, `.ordinalOf()`.
 * - Internal metadata (`enumName`, `codecId`, `nativeType`,
 *   `enumMembers`) for the lowering pipeline.
 *
 * The type is generic over the ordered value tuple so callers that assign
 * `const Role = enumType(...)` retain the literal tuple on `.values`.
 */
export interface EnumTypeHandle<
  Name extends string = string,
  Values extends readonly unknown[] = readonly unknown[],
  Names extends readonly string[] = readonly string[],
  MembersMap extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Internal brand for lowering-pipeline detection. */
  readonly [ENUM_TYPE_HANDLE_BRAND]: true;

  /** The enum's declared name (used as the key in domain `enum` / storage `valueSet`). */
  readonly enumName: Name;

  /** codecId from the codec passed to `enumType`. */
  readonly codecId: string;

  /** nativeType from the codec passed to `enumType`. */
  readonly nativeType: string;

  /** Ordered member list for lowering (name + value pairs). */
  readonly enumMembers: readonly { readonly name: string; readonly value: Values[number] }[];

  /** Ordered literal value tuple. Declaration order is preserved. */
  readonly values: Values;

  /** Ordered literal name tuple. Declaration order is preserved. */
  readonly names: Names;

  /**
   * Namespaced accessor map: `Role.members.User === 'user'`.
   * Namespaced under `.members` to avoid collisions with `.values` / `.has`.
   */
  readonly members: MembersMap;

  /** Returns `true` if `v` is a declared member value. */
  has(v: Values[number]): boolean;

  /** Returns the member name for a value, or `undefined` if not found. */
  nameOf(v: Values[number]): string | undefined;

  /** Returns the zero-based declaration index of a value, or `-1` if not found. */
  ordinalOf(v: Values[number]): number;
}

// ---------------------------------------------------------------------------
// enumType()
// ---------------------------------------------------------------------------

/**
 * The application input type a codec descriptor dictates for its values. The
 * `enumType` codec argument is a {@link ColumnTypeDescriptor}; descriptors may
 * carry an optional `__input` phantom that pins the codec's JS input type
 * (e.g. `string` for `pg/text@1`, `number` for `pg/int4@1`). When the descriptor
 * carries no phantom the input is unconstrained, so any member-value literal is
 * accepted and inferred verbatim.
 */
type CodecInput<Codec> = Codec extends { readonly __input?: infer In } ? In : unknown;

/**
 * Declare a domain enum for use in TS-authoring contracts.
 *
 * - The codec is an explicit required argument — the `codecId` and
 *   `nativeType` are taken from the passed `ColumnTypeDescriptor` (e.g.
 *   `{ codecId: 'pg/text@1', nativeType: 'text' }` from a field preset
 *   output or a direct inline object).
 * - `const` generics on the members spread preserve the ordered literal
 *   value tuple so `Role.values` is `readonly ['user','admin']`, not
 *   `string[]`.
 * - Well-formedness assertions at construction: non-empty member list;
 *   unique names; unique values.
 *
 * The returned handle wires into `field.namedType(handle)` to set
 * `valueSet` refs on both the domain field and the storage column.
 *
 * @example
 * ```ts
 * const Role = enumType('Role', { codecId: 'pg/text@1', nativeType: 'text' },
 *   member('User', 'user'),
 *   member('Admin', 'admin'),
 * );
 * // Role.values → readonly ['user', 'admin']
 * // Role.members.User → 'user'
 * ```
 */
export function enumType<
  const Name extends string,
  const Codec extends Pick<ColumnTypeDescriptor, 'codecId' | 'nativeType'>,
  const Members extends readonly [
    EnumMember<string, CodecInput<Codec>>,
    ...EnumMember<string, CodecInput<Codec>>[],
  ],
>(
  name: Name,
  codec: Codec,
  ...members: Members
): EnumTypeHandle<
  Name,
  MembersToValues<[...Members]>,
  MembersToNames<[...Members]>,
  MembersAccessorMap<[...Members]>
>;
export function enumType(
  name: string,
  codec: Pick<ColumnTypeDescriptor, 'codecId' | 'nativeType'>,
  ...members: EnumMember<string, unknown>[]
): EnumTypeHandle;
export function enumType(
  name: string,
  codec: Pick<ColumnTypeDescriptor, 'codecId' | 'nativeType'>,
  ...members: EnumMember<string, unknown>[]
): EnumTypeHandle {
  if (members.length === 0) {
    throw new Error(`enumType("${name}"): must have at least one member.`);
  }

  const seenNames = new Set<string>();
  const seenValues = new Set<string>();
  for (const m of members) {
    if (seenNames.has(m.name)) {
      throw new Error(
        `enumType("${name}"): duplicate member name "${m.name}". Member names must be unique.`,
      );
    }
    seenNames.add(m.name);

    const loweredValue = String(m.value);
    if (seenValues.has(loweredValue)) {
      throw new Error(
        `enumType("${name}"): duplicate member value "${loweredValue}". Member values must be unique.`,
      );
    }
    seenValues.add(loweredValue);
  }

  const values = Object.freeze(members.map((m) => m.value));
  const names = Object.freeze(members.map((m) => m.name));
  const enumMembers = Object.freeze(members.map((m) => ({ name: m.name, value: m.value })));

  const membersAccessor = Object.freeze(Object.fromEntries(members.map((m) => [m.name, m.value])));

  const valueSet = new Set(values);
  const valueToName = new Map(members.map((m) => [m.value, m.name]));
  const valueToOrdinal = new Map(values.map((v, i) => [v, i]));

  return {
    [ENUM_TYPE_HANDLE_BRAND]: true,
    enumName: name,
    codecId: codec.codecId,
    nativeType: codec.nativeType,
    enumMembers,
    values,
    names,
    members: membersAccessor,
    has: (v: unknown) => valueSet.has(v),
    nameOf: (v: unknown) => valueToName.get(v),
    ordinalOf: (v: unknown) => valueToOrdinal.get(v) ?? -1,
  };
}

/**
 * Returns true when the value is an `EnumTypeHandle` produced by
 * `enumType()`. Used in the lowering pipeline to detect enum handles
 * in field state without importing the BRAND symbol at every call site.
 */
export function isEnumTypeHandle(value: unknown): value is EnumTypeHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, ENUM_TYPE_HANDLE_BRAND) === true
  );
}
