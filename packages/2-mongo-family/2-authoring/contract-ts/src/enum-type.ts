import { blindCast } from '@prisma-next/utils/casts';

// ---------------------------------------------------------------------------
// EnumMember — a single member declaration with literal type preservation
// ---------------------------------------------------------------------------

/**
 * A single enum member produced by `member()`. The `Name` and `Value` generics
 * are preserved as literal types so `enumType()` can carry the ordered value
 * tuple in its return type.
 */
export interface EnumMember<Name extends string, Value> {
  readonly name: Name;
  readonly value: Value;
}

/**
 * Declare an enum member. The `value` defaults to `name` when omitted.
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

/** Internal brand that identifies an EnumTypeHandle in the lowering pipeline. */
export const ENUM_TYPE_HANDLE_BRAND = Symbol('EnumTypeHandle');

/**
 * Authoring handle returned by `enumType()`. Carries the ordered literal value
 * tuple, name tuple, member accessor map, runtime helpers, and internal
 * metadata for the lowering pipeline.
 */
export interface EnumTypeHandle<
  Name extends string = string,
  Values extends readonly unknown[] = readonly unknown[],
  Names extends readonly string[] = readonly string[],
  MembersMap extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly [ENUM_TYPE_HANDLE_BRAND]: true;
  readonly enumName: Name;
  readonly codecId: string;
  readonly nativeType: string;
  readonly enumMembers: readonly { readonly name: string; readonly value: Values[number] }[];
  readonly values: Values;
  readonly names: Names;
  readonly members: MembersMap;
  has(v: Values[number]): boolean;
  nameOf(v: Values[number]): string | undefined;
  ordinalOf(v: Values[number]): number;
}

// ---------------------------------------------------------------------------
// enumType()
// ---------------------------------------------------------------------------

export type CodecTypeMap = Record<string, { readonly input?: unknown }>;

export type CodecInput<
  CodecTypes extends CodecTypeMap,
  Codec extends { readonly codecId: string },
> = Codec['codecId'] extends keyof CodecTypes
  ? CodecTypes[Codec['codecId']] extends { readonly input: infer In }
    ? In
    : unknown
  : unknown;

type ColumnTypeDescriptorLike = { readonly codecId: string; readonly nativeType: string };

export function enumType<
  CodecTypes extends CodecTypeMap = Record<string, never>,
  const Name extends string = string,
  const Codec extends ColumnTypeDescriptorLike = ColumnTypeDescriptorLike,
  const Members extends readonly [
    EnumMember<string, CodecInput<CodecTypes, Codec>>,
    ...EnumMember<string, CodecInput<CodecTypes, Codec>>[],
  ] = readonly [EnumMember<string, CodecInput<CodecTypes, Codec>>],
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
  codec: ColumnTypeDescriptorLike,
  ...members: EnumMember<string, unknown>[]
): EnumTypeHandle;
export function enumType(
  name: string,
  codec: ColumnTypeDescriptorLike,
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

export type BoundEnumType<CodecTypes extends CodecTypeMap> = <
  const Name extends string,
  const Codec extends ColumnTypeDescriptorLike,
  const Members extends readonly [
    EnumMember<string, CodecInput<CodecTypes, Codec>>,
    ...EnumMember<string, CodecInput<CodecTypes, Codec>>[],
  ],
>(
  name: Name,
  codec: Codec,
  ...members: Members
) => EnumTypeHandle<
  Name,
  MembersToValues<[...Members]>,
  MembersToNames<[...Members]>,
  MembersAccessorMap<[...Members]>
>;

/** Bind `enumType` to a target's codec typemap. */
export function bindEnumType<CodecTypes extends CodecTypeMap>(): BoundEnumType<CodecTypes> {
  return enumType;
}

/** Returns true when the value is an `EnumTypeHandle` produced by `enumType()`. */
export function isEnumTypeHandle(value: unknown): value is EnumTypeHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, ENUM_TYPE_HANDLE_BRAND) === true
  );
}
