import type { ContractField, ContractValueObject } from '@prisma-next/contract/types';
import type {
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@prisma-next/mongo-contract';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';

// ── Runtime types ────────────────────────────────────────────────────────────

export type UpdateOperator =
  | '$set'
  | '$unset'
  | '$inc'
  | '$mul'
  | '$push'
  | '$pull'
  | '$addToSet'
  | '$pop';

export interface FieldOperation {
  readonly operator: UpdateOperator;
  readonly field: string;
  readonly value: MongoValue;
}

// ── Compile-time types ───────────────────────────────────────────────────────

type ScalarFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['fields'] &
    string]: TContract['models'][ModelName]['fields'][K] extends {
    readonly type: { readonly kind: 'scalar' };
  }
    ? K
    : never;
}[keyof TContract['models'][ModelName]['fields'] & string];

type ValueObjectFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in keyof TContract['models'][ModelName]['fields'] &
    string]: TContract['models'][ModelName]['fields'][K] extends {
    readonly type: { readonly kind: 'valueObject'; readonly name: string };
  }
    ? K
    : never;
}[keyof TContract['models'][ModelName]['fields'] & string];

type ResolveFieldType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  K extends keyof TContract['models'][ModelName]['fields'] & string,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = TContract['models'][ModelName]['fields'][K] extends {
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: infer CId extends string & keyof TCodecTypes;
  };
  readonly many: true;
}
  ? TCodecTypes[CId]['output'][]
  : TContract['models'][ModelName]['fields'][K] extends {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends string & keyof TCodecTypes;
        };
      }
    ? TCodecTypes[CId]['output']
    : unknown;

export interface FieldExpression<T = unknown> {
  set(value: T): FieldOperation;
  unset(): FieldOperation;
  inc(value: number): FieldOperation;
  mul(value: number): FieldOperation;
  push(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pull(match: T extends readonly (infer E)[] ? E | Partial<E> : unknown): FieldOperation;
  addToSet(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pop(end: 1 | -1): FieldOperation;
}

type HasValueObjects = { readonly valueObjects?: Record<string, ContractValueObject> };

type VOFields<TContract extends HasValueObjects, VOName extends string> = TContract extends {
  readonly valueObjects: infer VOs extends Record<string, ContractValueObject>;
}
  ? VOName extends keyof VOs
    ? VOs[VOName]['fields']
    : never
  : never;

type VOScalarFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends { readonly type: { readonly kind: 'scalar' } }
    ? K
    : never;
}[keyof Fields & string];

type VOValueObjectFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends {
    readonly type: { readonly kind: 'valueObject'; readonly name: string };
  }
    ? K
    : never;
}[keyof Fields & string];

type VODotPaths<
  TContract extends HasValueObjects,
  Fields extends Record<string, ContractField>,
  Prefix extends string,
> =
  | { [K in VOScalarFieldKeys<Fields>]: `${Prefix}${K}` }[VOScalarFieldKeys<Fields>]
  | {
      [K in VOValueObjectFieldKeys<Fields>]: Fields[K] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
        ? VODotPaths<TContract, VOFields<TContract, N>, `${Prefix}${K}.`>
        : never;
    }[VOValueObjectFieldKeys<Fields>];

export type DotPath<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = {
  [K in ValueObjectFieldKeys<
    TContract,
    ModelName
  >]: TContract['models'][ModelName]['fields'][K] extends {
    readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
  }
    ? VODotPaths<TContract, VOFields<TContract, N>, `${K}.`>
    : never;
}[ValueObjectFieldKeys<TContract, ModelName>];

type ResolveDotPathInFields<
  TContract extends HasValueObjects,
  Fields extends Record<string, ContractField>,
  Path extends string,
  TCodecTypes extends Record<string, { output: unknown }>,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Fields & string
    ? Fields[Head] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
      ? ResolveDotPathInFields<TContract, VOFields<TContract, N>, Rest, TCodecTypes>
      : never
    : never
  : Path extends keyof Fields & string
    ? Fields[Path] extends {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends string & keyof TCodecTypes;
        };
      }
      ? TCodecTypes[CId]['output']
      : unknown
    : never;

export type ResolveDotPathType<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
  Path extends string,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof TContract['models'][ModelName]['fields'] & string
    ? TContract['models'][ModelName]['fields'][Head] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
      ? ResolveDotPathInFields<TContract, VOFields<TContract, N>, Rest, TCodecTypes>
      : never
    : never
  : never;

export type FieldAccessor<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = {
  readonly [K in ScalarFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K>
  >;
} & {
  readonly [K in ValueObjectFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K>
  >;
} & (<P extends DotPath<TContract, ModelName>>(
    path: P,
  ) => FieldExpression<ResolveDotPathType<TContract, ModelName, P>>);

// ── Runtime implementation ───────────────────────────────────────────────────

function createFieldExpression(fieldPath: string): FieldExpression {
  return {
    set(value: unknown): FieldOperation {
      return { operator: '$set', field: fieldPath, value: new MongoParamRef(value) };
    },
    unset(): FieldOperation {
      return { operator: '$unset', field: fieldPath, value: new MongoParamRef('') };
    },
    inc(value: number): FieldOperation {
      return { operator: '$inc', field: fieldPath, value: new MongoParamRef(value) };
    },
    mul(value: number): FieldOperation {
      return { operator: '$mul', field: fieldPath, value: new MongoParamRef(value) };
    },
    push(value: unknown): FieldOperation {
      return { operator: '$push', field: fieldPath, value: new MongoParamRef(value) };
    },
    pull(match: unknown): FieldOperation {
      return { operator: '$pull', field: fieldPath, value: new MongoParamRef(match) };
    },
    addToSet(value: unknown): FieldOperation {
      return { operator: '$addToSet', field: fieldPath, value: new MongoParamRef(value) };
    },
    pop(end: 1 | -1): FieldOperation {
      return { operator: '$pop', field: fieldPath, value: new MongoParamRef(end) };
    },
  };
}

export function createFieldAccessor<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
>(): FieldAccessor<TContract, ModelName> {
  return new Proxy((() => {}) as unknown as FieldAccessor<TContract, ModelName>, {
    get(_target, prop: string): FieldExpression {
      return createFieldExpression(prop);
    },
    apply(_target, _thisArg, args: [string]): FieldExpression {
      return createFieldExpression(args[0]);
    },
  });
}

export function compileFieldOperations(
  ops: readonly FieldOperation[],
  wrapValue: (field: string, value: MongoValue, operator: UpdateOperator) => MongoValue,
): Record<string, Record<string, MongoValue>> {
  const grouped: Record<string, Record<string, MongoValue>> = {};
  for (const op of ops) {
    if (!grouped[op.operator]) {
      grouped[op.operator] = {};
    }
    grouped[op.operator]![op.field] = wrapValue(op.field, op.value, op.operator);
  }
  return grouped;
}
