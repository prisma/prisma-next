import type { ContractEnum } from '@prisma-next/contract/types';

export interface EnumAccessor {
  readonly values: readonly string[];
  readonly names: readonly string[];
  readonly members: Readonly<Record<string, string>>;
  has(v: string): boolean;
  nameOf(v: string): string | undefined;
  ordinalOf(v: string): number;
}

export function createEnumAccessor(contractEnum: ContractEnum): EnumAccessor {
  const values = Object.freeze(contractEnum.members.map((m) => m.value));
  const names = Object.freeze(contractEnum.members.map((m) => m.name));
  const members: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(contractEnum.members.map((m) => [m.name, m.value])),
  );

  const valueSet = new Set(values);
  const valueToName = new Map(contractEnum.members.map((m) => [m.value, m.name]));
  const valueToOrdinal = new Map(values.map((v, i) => [v, i]));

  return {
    values,
    names,
    members,
    has: (v: string) => valueSet.has(v),
    nameOf: (v: string) => valueToName.get(v),
    ordinalOf: (v: string) => valueToOrdinal.get(v) ?? -1,
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
