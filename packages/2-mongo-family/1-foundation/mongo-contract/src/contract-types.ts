import type { Contract, ContractModel, StorageBase } from '@prisma-next/contract/types';
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

export type MongoContract<S extends MongoStorageShape = MongoStorageShape> = Contract<S>;

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
 * {@link UNBOUND_NAMESPACE_ID}. A map without that coordinate (e.g. a contract
 * carrying no type maps) resolves to `never`, which the row resolvers read as
 * "no refined map" and fall back to codec-based inference.
 */
export type MongoUnboundFieldOutputTypes<T> =
  ExtractMongoFieldOutputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : never;

/** Input-side counterpart of {@link MongoUnboundFieldOutputTypes}. */
export type MongoUnboundFieldInputTypes<T> =
  ExtractMongoFieldInputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : never;

// Base (modifier-free) type of a field in the codec-output fallback. Scalars
// resolve through the supplied codec-output map; value-object fields recurse
// into the `valueObjects` registry so nested documents keep their shape;
// anything else (unions, unresolvable codecs) is best-effort `unknown`. Enum
// narrowing is NOT done here — that refinement lives in the precomputed map.
type InferFieldFallbackBase<
  TValueObjects extends Record<string, { readonly fields: Record<string, unknown> }>,
  TCodecTypes extends Record<string, { output: unknown }>,
  TFieldType,
> = TFieldType extends { readonly kind: 'scalar'; readonly codecId: infer CId extends string }
  ? CId extends keyof TCodecTypes
    ? TCodecTypes[CId]['output']
    : unknown
  : TFieldType extends { readonly kind: 'valueObject'; readonly name: infer VOName extends string }
    ? VOName extends keyof TValueObjects
      ? {
          -readonly [K in keyof TValueObjects[VOName]['fields']]: InferFieldFallback<
            TValueObjects,
            TCodecTypes,
            TValueObjects[VOName]['fields'][K]
          >;
        }
      : unknown
    : unknown;

type ApplyFieldModifiers<TField, TBase> = TField extends { readonly many: true }
  ? TField extends { readonly nullable: true }
    ? TBase[] | null
    : TBase[]
  : TField extends { readonly nullable: true }
    ? TBase | null
    : TBase;

type InferFieldFallback<
  TValueObjects extends Record<string, { readonly fields: Record<string, unknown> }>,
  TCodecTypes extends Record<string, { output: unknown }>,
  TField,
> = TField extends { readonly type: infer FieldType }
  ? ApplyFieldModifiers<TField, InferFieldFallbackBase<TValueObjects, TCodecTypes, FieldType>>
  : unknown;

type MongoValueObjectsMap<TContract extends MongoContract> =
  TContract['domain']['namespaces'][typeof UNBOUND_NAMESPACE_ID] extends {
    readonly valueObjects: infer VOs extends Record<
      string,
      { readonly fields: Record<string, unknown> }
    >;
  }
    ? VOs
    : Record<string, never>;

export type InferModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TFields extends Record<string, unknown> = MongoModelsMap<TContract>[ModelName]['fields'],
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
  TValueObjects extends Record<
    string,
    { readonly fields: Record<string, unknown> }
  > = MongoValueObjectsMap<TContract>,
> = [MongoUnboundFieldOutputTypes<TContract>] extends [never]
  ? FallbackModelRow<TFields, TCodecTypes, TValueObjects>
  : string extends keyof MongoUnboundFieldOutputTypes<TContract>
    ? FallbackModelRow<TFields, TCodecTypes, TValueObjects>
    : ModelName extends keyof MongoUnboundFieldOutputTypes<TContract>
      ? MongoUnboundFieldOutputTypes<TContract>[ModelName]
      : FallbackModelRow<TFields, TCodecTypes, TValueObjects>;

type FallbackModelRow<
  TFields extends Record<string, unknown>,
  TCodecTypes extends Record<string, { output: unknown }>,
  TValueObjects extends Record<string, { readonly fields: Record<string, unknown> }>,
> = {
  -readonly [K in keyof TFields]: InferFieldFallback<TValueObjects, TCodecTypes, TFields[K]>;
};
