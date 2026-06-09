import type { ContractEnum, JsonValue } from '@prisma-next/contract/types';

/**
 * Runtime view of a domain enum, built at the client from the emitted
 * `ContractEnum` JSON (codec-encoded `JsonValue` members, literal types erased).
 *
 * This deliberately mirrors the accessor shape of the authoring-time
 * `EnumTypeHandle` (in `contract-ts`) rather than reusing it: that handle carries
 * the literal value generics and lives in the authoring layer, which the runtime
 * orm-client cannot depend on. The two are the same surface seen from the two
 * planes — authoring (typed) and runtime (validated JSON).
 */
export interface EnumAccessor {
  readonly values: readonly JsonValue[];
  readonly names: readonly string[];
  readonly members: Readonly<Record<string, JsonValue>>;
  has(v: JsonValue): boolean;
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
  const valueToName = new Map(contractEnum.members.map((m) => [m.value, m.name]));
  const valueToOrdinal = new Map(values.map((v, i) => [v, i]));

  return {
    values,
    names,
    members,
    has: (v: JsonValue) => valueSet.has(v),
    nameOf: (v: JsonValue) => valueToName.get(v),
    ordinalOf: (v: JsonValue) => valueToOrdinal.get(v) ?? -1,
  };
}

export function buildEnumsMap(domain: {
  readonly namespaces: Readonly<
    Record<string, { readonly enum?: Readonly<Record<string, ContractEnum>> }>
  >;
}): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  for (const namespace of Object.values(domain.namespaces)) {
    if (namespace.enum) {
      for (const [name, contractEnum] of Object.entries(namespace.enum)) {
        result[name] = createEnumAccessor(contractEnum);
      }
    }
  }
  return result;
}
