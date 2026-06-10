import type {
  Contract,
  ContractField,
  ContractModel,
  ContractValueObject,
  ContractValueObjectDefinitions,
  StorageBase,
} from '@prisma-next/contract/types';
import type { Namespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { MongoIndexOptionsInput } from './ir/mongo-index-options';

export type MongoIndexFieldValue = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';

export type MongoIndexFields = Record<string, MongoIndexFieldValue>;

export type MongoJsonPrimitive = string | number | boolean | null;

export type MongoJsonValue = MongoJsonPrimitive | readonly MongoJsonValue[] | MongoJsonObject;

export type MongoJsonObject = {
  readonly [key: string]: MongoJsonValue;
};

export type MongoWildcardProjection = Readonly<Record<string, 0 | 1>>;

/**
 * Authoring-DSL shape for a single index entry on a model — the
 * `indexes` array element accepted by the contract-ts builder. The
 * builder translates these (with model context) into {@link MongoIndex}
 * IR-class instances on `MongoCollection.indexes`.
 */
export type MongoIndexAuthoringInput = {
  readonly fields: MongoIndexFields;
  readonly options?: MongoIndexOptionsInput;
};

export type MongoIndexKeyDirection = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';

export interface MongoIndexKey {
  readonly field: string;
  readonly direction: MongoIndexKeyDirection;
}

export type MongoModelStorage = {
  readonly collection?: string;
  readonly relations?: Record<string, { readonly field: string }>;
};

export type MongoModelDefinition = ContractModel<MongoModelStorage>;

/**
 * Data-shape constraint for the Mongo family's storage block. The
 * runtime in-memory representation is the concrete {@link MongoStorage}
 * class from `./ir/mongo-storage`; this type is the structural superset
 * used as the generic-parameter constraint so consumers can name
 * `MongoContract<...>` over either the raw JSON envelope (no
 * `namespaces` field) or a fully-constructed class instance (with
 * `namespaces`). The class structurally satisfies this shape.
 */
import type { MongoCollection } from './ir/mongo-collection';

type MongoNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly collection?: Readonly<Record<string, MongoCollection>>;
};

export type MongoStorageShape<THash extends string = string> = StorageBase<THash> & {
  readonly namespaces: Record<
    string,
    Namespace & {
      readonly entries: MongoNamespaceEntries;
    }
  >;
};

export type MongoContract<
  S extends MongoStorageShape = MongoStorageShape,
  M extends Record<string, MongoModelDefinition> = Record<string, MongoModelDefinition>,
> = Contract<S, M>;

/**
 * Model map for the contract's sole (unbound) domain namespace. Mongo is
 * structurally single-namespace, so its models live under
 * {@link UNBOUND_NAMESPACE_ID} rather than in a flat cross-namespace union.
 * Every Mongo type that needs the model map reads it through here, so none
 * indexes the contract's namespaces directly.
 */
export type MongoModelsMap<TContract extends MongoContract> =
  TContract['domain']['namespaces'][typeof UNBOUND_NAMESPACE_ID]['models'];

export type RootModelName<
  TContract extends MongoContract,
  RootName extends keyof TContract['roots'] & string,
> = TContract['roots'][RootName] extends { readonly model: infer M extends string }
  ? M & keyof MongoModelsMap<TContract>
  : never;

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, { output: unknown }>,
  TFieldOutputTypes extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
  TFieldInputTypes extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
> = {
  readonly codecTypes: TCodecTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
  readonly fieldInputTypes: TFieldInputTypes;
};

export type MongoTypeMapsPhantomKey = '__@prisma-next/mongo-core/typeMaps@__';

export type MongoContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in MongoTypeMapsPhantomKey]?: TTypeMaps;
};

export type ExtractMongoTypeMaps<T> = MongoTypeMapsPhantomKey extends keyof T
  ? NonNullable<T[MongoTypeMapsPhantomKey & keyof T]>
  : never;

export type ExtractMongoCodecTypes<T> =
  ExtractMongoTypeMaps<T> extends { codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;

export type ExtractMongoFieldOutputTypes<T> =
  ExtractMongoTypeMaps<T> extends { fieldOutputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

export type ExtractMongoFieldInputTypes<T> =
  ExtractMongoTypeMaps<T> extends { fieldInputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

/**
 * The per-model field-output map at the contract's unbound namespace. The
 * framework emitter nests `FieldOutputTypes` by namespace id
 * (`{ [ns]: { [model]: { [field]: <refined> } } }`); Mongo is structurally
 * single-namespace, so its refined rows resolve the per-model map under
 * {@link UNBOUND_NAMESPACE_ID}. A pre-nesting (flat, model-keyed) map is read
 * as-is, so a refined row never silently degrades to the codec fallback.
 */
export type MongoUnboundFieldOutputTypes<T> =
  ExtractMongoFieldOutputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : ExtractMongoFieldOutputTypes<T>;

/** Input-side counterpart of {@link MongoUnboundFieldOutputTypes}. */
export type MongoUnboundFieldInputTypes<T> =
  ExtractMongoFieldInputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : ExtractMongoFieldInputTypes<T>;

type ExtractValueObjects<TContract extends Contract> = ContractValueObjectDefinitions<TContract>;

type NormalizeContractFields<TFields> = {
  [K in keyof TFields]: TFields[K] extends ContractField ? TFields[K] : never;
};

type ExtractValueObjectFields<
  TValueObjects extends Record<string, ContractValueObject>,
  VOName extends keyof TValueObjects,
> = NormalizeContractFields<TValueObjects[VOName]['fields']>;

type InferFieldBaseType<
  TFieldType,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TFieldType extends { kind: 'scalar'; codecId: infer CId extends string & keyof TCodecTypes }
  ? TCodecTypes[CId]['output']
  : TFieldType extends { kind: 'valueObject'; name: infer VOName extends string }
    ? VOName extends keyof TValueObjects
      ? {
          -readonly [K in keyof ExtractValueObjectFields<TValueObjects, VOName>]: InferFieldType<
            ExtractValueObjectFields<TValueObjects, VOName>[K],
            TValueObjects,
            TCodecTypes
          >;
        }
      : unknown
    : TFieldType extends {
          kind: 'union';
          members: infer TMembers extends ReadonlyArray<unknown>;
        }
      ? TMembers[number] extends infer TMember
        ? InferFieldBaseType<TMember, TValueObjects, TCodecTypes>
        : unknown
      : unknown;

type InferFieldType<
  TField,
  TValueObjects extends Record<string, ContractValueObject>,
  TCodecTypes extends Record<string, { output: unknown }>,
> = TField extends ContractField
  ? TField extends { many: true }
    ? TField['nullable'] extends true
      ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[] | null
      : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>[]
    : TField['nullable'] extends true
      ? InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes> | null
      : InferFieldBaseType<TField['type'], TValueObjects, TCodecTypes>
  : never;

export type InferModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TFields extends Record<string, ContractField> = MongoModelsMap<TContract>[ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
  TValueObjects extends Record<string, ContractValueObject> = ExtractValueObjects<TContract>,
> = {
  -readonly [FieldName in keyof TFields]: InferFieldType<
    TFields[FieldName],
    TValueObjects,
    TCodecTypes
  >;
};
