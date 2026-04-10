import { computeProfileHash, computeStorageHash } from '@prisma-next/contract/hashing';
import type {
  ContractEmbedRelation,
  ContractField,
  ContractFieldType,
  ContractReferenceRelation,
  ContractValueObject,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import {
  type MongoCollectionOptions,
  type MongoContract,
  type MongoContractWithTypeMaps,
  type MongoIndex,
  type MongoIndexFields,
  type MongoIndexOptions,
  type MongoStorage,
  type MongoStorageCollection,
  type MongoStorageCollectionOptions,
  type MongoStorageIndex,
  type MongoTypeMaps,
  validateMongoContract,
} from '@prisma-next/mongo-contract';

type VariantSpec = {
  readonly value: string;
};

type StorageRelationSpec = {
  readonly field: string;
};

type ContractCapabilities = Record<string, Record<string, boolean>>;
type StringListInput = string | readonly string[];
type Present<T> = Exclude<T, undefined>;
type EmptyObject = Record<never, never>;
type Simplify<T> = { [K in keyof T]: T[K] } & EmptyObject;
type StrictShape<Actual, Shape> = Actual &
  Shape &
  Record<Exclude<keyof Actual, keyof Shape>, never>;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export type ExtractCodecTypesFromPack<P> = P extends { __codecTypes?: infer CodecTypes }
  ? CodecTypes extends Record<string, { output: unknown }>
    ? CodecTypes
    : Record<string, never>
  : Record<string, never>;

// This mirrors @prisma-next/target-mongo/codec-types because authoring must stay decoupled from
// the target layer while still exposing the built-in Mongo codec registry to type inference.
type MongoCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
  };
};

type MergeExtensionCodecTypes<Packs extends Record<string, unknown>> = UnionToIntersection<
  {
    [K in keyof Packs]: ExtractCodecTypesFromPack<Packs[K]>;
  }[keyof Packs]
>;

type MergeExtensionCodecTypesSafe<Packs> =
  Packs extends Record<string, unknown>
    ? keyof Packs extends never
      ? Record<string, never>
      : MergeExtensionCodecTypes<Packs>
    : Record<string, never>;

export interface FieldBuilder<
  Type extends ContractFieldType = ContractFieldType,
  Nullable extends boolean = boolean,
  Many extends boolean = boolean,
> {
  readonly __kind: 'field';
  readonly __type: Type;
  readonly __nullable: Nullable;
  readonly __many: Many;
  optional(): FieldBuilder<Type, true, Many>;
  many(): FieldBuilder<Type, Nullable, true>;
}

export interface ValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, FieldBuilder> = Record<string, FieldBuilder>,
> {
  readonly __kind: 'valueObject';
  readonly __name: Name;
  readonly __fields: Fields;
}

export interface FieldReference<
  ModelName extends string = string,
  FieldName extends string = string,
> {
  readonly __kind: 'fieldRef';
  readonly modelName: ModelName;
  readonly fieldName: FieldName;
}

export interface RelationOn<
  LocalFields extends readonly string[] = readonly string[],
  TargetFields extends readonly string[] = readonly string[],
> {
  readonly localFields: LocalFields;
  readonly targetFields: TargetFields;
}

export interface RelationBuilder<
  To extends string = string,
  Cardinality extends '1:1' | '1:N' | 'N:1' = '1:1' | '1:N' | 'N:1',
  On extends RelationOn | undefined = RelationOn | undefined,
> {
  readonly __kind: 'relation';
  readonly __to: To;
  readonly __cardinality: Cardinality;
  readonly __on: On;
}

export interface ModelBuilder<
  Name extends string = string,
  Fields extends Record<string, FieldBuilder> = Record<string, FieldBuilder>,
  Relations extends Record<string, RelationBuilder> = Record<string, RelationBuilder>,
  Collection extends string | undefined = string | undefined,
  Owner extends string | undefined = string | undefined,
  Base extends string | undefined = string | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined =
    | Record<string, StorageRelationSpec>
    | undefined,
  Discriminator extends { readonly field: string } | undefined =
    | { readonly field: string }
    | undefined,
  Variants extends Record<string, VariantSpec> | undefined =
    | Record<string, VariantSpec>
    | undefined,
> {
  readonly __kind: 'model';
  readonly __name: Name;
  readonly __fields: Fields;
  readonly __relations: Relations;
  readonly __indexes: readonly MongoIndex[] | undefined;
  readonly __collectionOptions: MongoCollectionOptions | undefined;
  readonly __collection: Collection;
  readonly __owner: Owner;
  readonly __base: Base;
  readonly __storageRelations: StorageRelations;
  readonly __discriminator: Discriminator;
  readonly __variants: Variants;
  ref<const FieldName extends keyof Fields & string>(
    fieldName: FieldName,
  ): FieldReference<Name, FieldName>;
}

type AnyFieldBuilder = FieldBuilder<ContractFieldType, boolean, boolean>;
type AnyReferenceRelationBuilder = RelationBuilder<string, '1:1' | '1:N' | 'N:1', RelationOn>;
type AnyEmbedRelationBuilder = RelationBuilder<string, '1:1' | '1:N', undefined>;
type AnyRelationBuilder = AnyReferenceRelationBuilder | AnyEmbedRelationBuilder;
type AnyFieldReference = FieldReference<string, string>;
type NamedValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
> = ValueObjectBuilder<Name, Fields>;
type AnyValueObjectBuilder = NamedValueObjectBuilder;
type NamedModelBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<string, AnyRelationBuilder>,
  Collection extends string | undefined = string | undefined,
  Owner extends string | undefined = string | undefined,
  Base extends string | undefined = string | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined =
    | Record<string, StorageRelationSpec>
    | undefined,
  Discriminator extends { readonly field: string } | undefined =
    | { readonly field: string }
    | undefined,
  Variants extends Record<string, VariantSpec> | undefined =
    | Record<string, VariantSpec>
    | undefined,
> = ModelBuilder<
  Name,
  Fields,
  Relations,
  Collection,
  Owner,
  Base,
  StorageRelations,
  Discriminator,
  Variants
>;
type AnyModelBuilder = NamedModelBuilder;

type ExtractFieldReferenceName<T> =
  T extends FieldReference<string, infer FieldName extends string> ? FieldName : never;
type ExtractModelName<T> = T extends NamedModelBuilder<infer Name> ? Name : never;
type ExtractValueObjectName<T> = T extends NamedValueObjectBuilder<infer Name> ? Name : never;
type ExtractModelCollection<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    infer Collection
  >
    ? Collection
    : never;
type ExtractModelOwner<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    infer Owner
  >
    ? Owner
    : never;
type ExtractModelBase<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    string | undefined,
    infer Base
  >
    ? Base
    : never;
type ExtractModelStorageRelations<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    string | undefined,
    string | undefined,
    infer StorageRelations
  >
    ? StorageRelations
    : never;

type ModelStorageSection<T> =
  ExtractModelCollection<T> extends string
    ? { readonly collection: ExtractModelCollection<T> }
    : EmptyObject;
type ModelStorageRelationsSection<T> =
  ExtractModelStorageRelations<T> extends Record<string, StorageRelationSpec>
    ? keyof ExtractModelStorageRelations<T> extends never
      ? EmptyObject
      : { readonly relations: ExtractModelStorageRelations<T> }
    : EmptyObject;
type RootModelCollection<T> =
  ExtractModelCollection<T> extends string
    ? ExtractModelOwner<T> extends undefined
      ? ExtractModelBase<T> extends undefined
        ? ExtractModelCollection<T>
        : never
      : never
    : never;
type RootModelName<T> = RootModelCollection<T> extends never ? never : ExtractModelName<T>;
type CollectionName<T> =
  ExtractModelCollection<T> extends string ? ExtractModelCollection<T> : never;

type ModelNameInput = string | AnyModelBuilder;
type ValueObjectNameInput = string | AnyValueObjectBuilder;
type RelationTargetFieldsInput<TargetName extends string> =
  | StringListInput
  | FieldReference<TargetName, string>
  | readonly FieldReference<TargetName, string>[];

type NormalizeModelName<T> = T extends string ? T : ExtractModelName<T>;

type NormalizeModelNameOrUndefined<T> = [T] extends [undefined]
  ? undefined
  : NormalizeModelName<Present<T>>;

type NormalizeValueObjectName<T> = T extends string ? T : ExtractValueObjectName<T>;

type NormalizeStringList<T> = T extends readonly string[]
  ? T
  : T extends string
    ? readonly [T]
    : readonly string[];

type NormalizeTargetFieldList<T> = T extends readonly AnyFieldReference[]
  ? {
      readonly [K in keyof T]: ExtractFieldReferenceName<T[K]>;
    }
  : T extends AnyFieldReference
    ? readonly [ExtractFieldReferenceName<T>]
    : NormalizeStringList<T>;

type ContractFieldFromBuilder<TBuilder> =
  TBuilder extends FieldBuilder<
    infer Type extends ContractFieldType,
    infer Nullable extends boolean,
    infer Many extends boolean
  >
    ? Simplify<
        {
          readonly type: Type;
          readonly nullable: Nullable;
        } & (Many extends true ? { readonly many: true } : EmptyObject)
      >
    : never;

type ContractFieldsFromRecord<Fields extends Record<string, AnyFieldBuilder>> = Simplify<{
  readonly [K in keyof Fields]: ContractFieldFromBuilder<Fields[K]>;
}>;

type ContractValueObjectFromBuilder<TBuilder> =
  TBuilder extends ValueObjectBuilder<string, infer Fields extends Record<string, AnyFieldBuilder>>
    ? Simplify<{
        readonly fields: ContractFieldsFromRecord<Fields>;
      }>
    : never;

type ContractValueObjectsFromRecord<ValueObjects extends Record<string, AnyValueObjectBuilder>> =
  Simplify<{
    readonly [K in keyof ValueObjects as ExtractValueObjectName<
      ValueObjects[K]
    >]: ContractValueObjectFromBuilder<ValueObjects[K]>;
  }>;

type ContractRelationFromBuilder<TBuilder> =
  TBuilder extends RelationBuilder<
    infer To extends string,
    infer Cardinality extends '1:1' | '1:N' | 'N:1',
    infer On extends RelationOn | undefined
  >
    ? On extends RelationOn
      ? {
          readonly to: To;
          readonly cardinality: Cardinality;
          readonly on: On;
        }
      : {
          readonly to: To;
          readonly cardinality: Cardinality;
        }
    : never;

type ContractRelationsFromRecord<Relations extends Record<string, AnyRelationBuilder>> =
  keyof Relations extends never
    ? Record<string, never>
    : Simplify<{
        readonly [K in keyof Relations]: ContractRelationFromBuilder<Relations[K]>;
      }>;

type ContractModelStorageFromBuilder<TBuilder> = ModelStorageSection<TBuilder> &
  ModelStorageRelationsSection<TBuilder>;

type MaybeOwner<Owner> = [Owner] extends [undefined]
  ? EmptyObject
  : { readonly owner: Owner & string };
type MaybeBase<Base> = [Base] extends [undefined] ? EmptyObject : { readonly base: Base & string };
type MaybeDiscriminator<Discriminator> = [Discriminator] extends [undefined]
  ? EmptyObject
  : { readonly discriminator: Discriminator & { readonly field: string } };
type MaybeVariants<Variants> = [Variants] extends [undefined]
  ? EmptyObject
  : { readonly variants: Variants };

type ContractModelFromBuilder<TBuilder> =
  TBuilder extends NamedModelBuilder<
    string,
    infer Fields extends Record<string, AnyFieldBuilder>,
    infer Relations extends Record<string, AnyRelationBuilder>,
    string | undefined,
    infer Owner,
    infer Base,
    Record<string, StorageRelationSpec> | undefined,
    infer Discriminator,
    infer Variants
  >
    ? Simplify<
        {
          readonly fields: ContractFieldsFromRecord<Fields>;
          readonly relations: ContractRelationsFromRecord<Relations>;
          readonly storage: ContractModelStorageFromBuilder<TBuilder>;
        } & MaybeOwner<Owner> &
          MaybeBase<Base> &
          MaybeDiscriminator<Discriminator> &
          MaybeVariants<Variants>
      >
    : never;

type ContractModelsFromRecord<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as ExtractModelName<Models[K]>]: ContractModelFromBuilder<Models[K]>;
}>;

type DerivedRootModels<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as RootModelCollection<Models[K]>]: RootModelName<Models[K]>;
}>;

type StorageCollectionsFromModels<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as CollectionName<Models[K]>]: MongoStorageCollection;
}>;

type NormalizeRoots<Roots extends Record<string, ModelNameInput>> = Simplify<{
  readonly [K in keyof Roots]: NormalizeModelName<Roots[K]>;
}>;

type DefinitionModels<Definition> = Definition extends {
  readonly models?: infer Models extends Record<string, AnyModelBuilder>;
}
  ? Models
  : Record<never, never>;

type DefinitionValueObjects<Definition> = Definition extends {
  readonly valueObjects?: infer ValueObjects extends Record<string, AnyValueObjectBuilder>;
}
  ? ValueObjects
  : Record<never, never>;

type DefinitionRoots<Definition> = Definition extends {
  readonly roots?: infer Roots extends Record<string, ModelNameInput>;
}
  ? NormalizeRoots<Roots>
  : DerivedRootModels<DefinitionModels<Definition>>;

type DefinitionCapabilities<Definition> = Definition extends {
  readonly capabilities?: infer Capabilities extends ContractCapabilities;
}
  ? Capabilities
  : Record<never, never>;

type DefinitionExtensionPacks<Definition> = Definition extends {
  readonly extensionPacks?: infer ExtensionPacks extends Record<
    string,
    ExtensionPackRef<string, string>
  >;
}
  ? ExtensionPacks
  : Record<never, never>;

type DefinitionFamilyId<Definition> = Definition extends {
  readonly family: FamilyPackRef<infer FamilyId>;
}
  ? FamilyId
  : string;

type DefinitionTargetId<Definition> = Definition extends {
  readonly target: TargetPackRef<string, infer TargetId>;
}
  ? TargetId
  : string;

type DefinitionStorage<Definition> = Simplify<
  MongoStorage & {
    readonly collections: StorageCollectionsFromModels<DefinitionModels<Definition>>;
    readonly storageHash: StorageHashBase<string>;
  }
>;

type MaybeValueObjectsSection<ValueObjects extends Record<string, AnyValueObjectBuilder>> =
  keyof ValueObjects extends never
    ? EmptyObject
    : {
        readonly valueObjects: ContractValueObjectsFromRecord<ValueObjects>;
      };

type MongoContractBaseFromDefinition<Definition> = Simplify<
  {
    readonly target: DefinitionTargetId<Definition>;
    readonly targetFamily: DefinitionFamilyId<Definition>;
    readonly roots: DefinitionRoots<Definition>;
    readonly models: ContractModelsFromRecord<DefinitionModels<Definition>>;
    readonly storage: DefinitionStorage<Definition>;
    readonly capabilities: DefinitionCapabilities<Definition>;
    readonly extensionPacks: DefinitionExtensionPacks<Definition>;
    readonly profileHash: ProfileHashBase<string>;
    readonly meta: Record<string, never>;
  } & MaybeValueObjectsSection<DefinitionValueObjects<Definition>>
>;

type CodecTypesFromDefinition<Definition> = MongoCodecTypes &
  MergeExtensionCodecTypesSafe<DefinitionExtensionPacks<Definition>>;

export type MongoContractResult<Definition> = MongoContractWithTypeMaps<
  MongoContractBaseFromDefinition<Definition>,
  MongoTypeMaps<CodecTypesFromDefinition<Definition>>
>;

type ContractAuthoringHelpers = {
  readonly field: typeof field;
  readonly index: typeof index;
  readonly model: typeof model;
  readonly rel: typeof rel;
  readonly valueObject: typeof valueObject;
};

export type ContractScaffold<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<string, string>,
  ExtensionPacks extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
  Capabilities extends ContractCapabilities | undefined = undefined,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly capabilities?: Capabilities;
  readonly roots?: Roots;
};

export type ContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<string, string>,
  Models extends Record<string, AnyModelBuilder> = Record<never, never>,
  ValueObjects extends Record<string, AnyValueObjectBuilder> = Record<never, never>,
  ExtensionPacks extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
  Capabilities extends ContractCapabilities | undefined = undefined,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = ContractScaffold<Family, Target, ExtensionPacks, Capabilities, Roots> & {
  readonly models?: Models;
  readonly valueObjects?: ValueObjects;
};

export type ContractFactory<
  Models extends Record<string, AnyModelBuilder> = Record<never, never>,
  ValueObjects extends Record<string, AnyValueObjectBuilder> = Record<never, never>,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = (helpers: ContractAuthoringHelpers) => {
  readonly models?: Models;
  readonly valueObjects?: ValueObjects;
  readonly roots?: Roots;
};

type FieldBuilderSpec<
  Type extends ContractFieldType,
  Nullable extends boolean,
  Many extends boolean,
> = {
  readonly type: Type;
  readonly nullable: Nullable;
  readonly many: Many;
};

function createFieldBuilder<
  Type extends ContractFieldType,
  Nullable extends boolean,
  Many extends boolean,
>(spec: FieldBuilderSpec<Type, Nullable, Many>): FieldBuilder<Type, Nullable, Many> {
  return {
    __kind: 'field',
    __type: spec.type,
    __nullable: spec.nullable,
    __many: spec.many,
    optional() {
      return createFieldBuilder<Type, true, Many>({
        type: spec.type,
        nullable: true,
        many: spec.many,
      });
    },
    many() {
      return createFieldBuilder<Type, Nullable, true>({
        type: spec.type,
        nullable: spec.nullable,
        many: true,
      });
    },
  };
}

function normalizeOptionalTypeParams(
  typeParams: Record<string, unknown> | undefined,
): { readonly typeParams: Record<string, unknown> } | Record<never, never> {
  if (!typeParams) {
    return {};
  }

  return { typeParams };
}

function createScalarFieldBuilder<
  CodecId extends string,
  TypeParams extends Record<string, unknown> | undefined = undefined,
>(
  codecId: CodecId,
  options?: { readonly typeParams?: TypeParams },
): FieldBuilder<
  {
    readonly kind: 'scalar';
    readonly codecId: CodecId;
  } & ([TypeParams] extends [undefined] ? EmptyObject : { readonly typeParams: TypeParams }),
  false,
  false
> {
  return createFieldBuilder({
    type: {
      kind: 'scalar',
      codecId,
      ...normalizeOptionalTypeParams(options?.typeParams),
    } as {
      readonly kind: 'scalar';
      readonly codecId: CodecId;
    } & ([TypeParams] extends [undefined] ? EmptyObject : { readonly typeParams: TypeParams }),
    nullable: false,
    many: false,
  });
}

export const field = {
  scalar: createScalarFieldBuilder,
  objectId() {
    return createScalarFieldBuilder('mongo/objectId@1');
  },
  string() {
    return createScalarFieldBuilder('mongo/string@1');
  },
  double() {
    return createScalarFieldBuilder('mongo/double@1');
  },
  int32() {
    return createScalarFieldBuilder('mongo/int32@1');
  },
  bool() {
    return createScalarFieldBuilder('mongo/bool@1');
  },
  date() {
    return createScalarFieldBuilder('mongo/date@1');
  },
  vector<const TypeParams extends Record<string, unknown> | undefined = undefined>(options?: {
    readonly typeParams?: TypeParams;
  }) {
    return createScalarFieldBuilder('mongo/vector@1', options);
  },
  valueObject<const ValueObject extends ValueObjectNameInput>(valueObjectName: ValueObject) {
    return createFieldBuilder({
      type: {
        kind: 'valueObject',
        name: resolveValueObjectName(valueObjectName),
      } as {
        readonly kind: 'valueObject';
        readonly name: NormalizeValueObjectName<ValueObject>;
      },
      nullable: false,
      many: false,
    });
  },
} as const;

export function index<const Fields extends MongoIndexFields>(
  fields: Fields,
): {
  readonly fields: Fields;
};
export function index<const Fields extends MongoIndexFields, const Options>(
  fields: Fields,
  options: StrictShape<Options, MongoIndexOptions>,
): {
  readonly fields: Fields;
  readonly options: Options & MongoIndexOptions;
};
export function index(
  fields: MongoIndexFields,
  options?: MongoIndexOptions,
): {
  readonly fields: MongoIndexFields;
  readonly options?: MongoIndexOptions;
} {
  return {
    fields,
    ...(options ? { options } : {}),
  };
}

function createFieldReference<const ModelName extends string, const FieldName extends string>(
  modelName: ModelName,
  fieldName: FieldName,
): FieldReference<ModelName, FieldName> {
  return {
    __kind: 'fieldRef',
    modelName,
    fieldName,
  };
}

function isFieldReference(value: unknown): value is FieldReference<string, string> {
  return (
    typeof value === 'object' && value !== null && '__kind' in value && value.__kind === 'fieldRef'
  );
}

function resolveModelName(value: ModelNameInput): string {
  return typeof value === 'string' ? value : value.__name;
}

function resolveValueObjectName(value: ValueObjectNameInput): string {
  return typeof value === 'string' ? value : value.__name;
}

function normalizeStringList(value: StringListInput): readonly string[] {
  return typeof value === 'string' ? [value] : [...value];
}

function normalizeTargetField(
  targetModelName: string,
  value: string | FieldReference<string, string>,
): string {
  if (!isFieldReference(value)) {
    return value;
  }

  if (value.modelName !== targetModelName) {
    throw new Error(
      `Relation target "${targetModelName}" cannot reference field "${value.modelName}.${value.fieldName}".`,
    );
  }

  return value.fieldName;
}

function normalizeTargetFields(
  targetModelName: string,
  value: RelationTargetFieldsInput<string>,
): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (isFieldReference(value)) {
    return [normalizeTargetField(targetModelName, value)];
  }

  return value.map((entry) => normalizeTargetField(targetModelName, entry));
}

type ReferenceOptions<
  Target extends ModelNameInput,
  From extends StringListInput,
  To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
> = {
  readonly from: From;
  readonly to: To;
};

type RelationOnFromOptions<
  From extends StringListInput,
  To extends RelationTargetFieldsInput<string>,
> = {
  readonly localFields: NormalizeStringList<From>;
  readonly targetFields: NormalizeTargetFieldList<To>;
};

function createRelationBuilder<
  To extends string,
  Cardinality extends '1:1' | '1:N' | 'N:1',
  On extends RelationOn | undefined,
>(spec: {
  readonly to: To;
  readonly cardinality: Cardinality;
  readonly on: On;
}): RelationBuilder<To, Cardinality, On> {
  return {
    __kind: 'relation',
    __to: spec.to,
    __cardinality: spec.cardinality,
    __on: spec.on,
  };
}

function createReferenceRelationBuilder<
  Target extends ModelNameInput,
  Cardinality extends '1:1' | '1:N' | 'N:1',
  From extends StringListInput,
  To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  cardinality: Cardinality,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, Cardinality, RelationOnFromOptions<From, To>> {
  const targetModelName = resolveModelName(target);

  return createRelationBuilder({
    to: targetModelName as NormalizeModelName<Target>,
    cardinality,
    on: {
      localFields: normalizeStringList(options.from) as NormalizeStringList<From>,
      targetFields: normalizeTargetFields(
        targetModelName,
        options.to,
      ) as NormalizeTargetFieldList<To>,
    },
  });
}

function createEmbedRelationBuilder<
  Target extends ModelNameInput,
  Cardinality extends '1:1' | '1:N',
>(
  target: Target,
  cardinality: Cardinality,
): RelationBuilder<NormalizeModelName<Target>, Cardinality, undefined> {
  return createRelationBuilder({
    to: resolveModelName(target) as NormalizeModelName<Target>,
    cardinality,
    on: undefined,
  });
}

function hasOne<const Target extends ModelNameInput>(
  target: Target,
): RelationBuilder<NormalizeModelName<Target>, '1:1', undefined>;
function hasOne<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, '1:1', RelationOnFromOptions<From, To>>;
function hasOne(
  target: ModelNameInput,
  options?: ReferenceOptions<ModelNameInput, StringListInput, RelationTargetFieldsInput<string>>,
) {
  if (!options) {
    return createEmbedRelationBuilder(target, '1:1');
  }

  return createReferenceRelationBuilder(target, '1:1', options);
}

function hasMany<const Target extends ModelNameInput>(
  target: Target,
): RelationBuilder<NormalizeModelName<Target>, '1:N', undefined>;
function hasMany<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, '1:N', RelationOnFromOptions<From, To>>;
function hasMany(
  target: ModelNameInput,
  options?: ReferenceOptions<ModelNameInput, StringListInput, RelationTargetFieldsInput<string>>,
) {
  if (!options) {
    return createEmbedRelationBuilder(target, '1:N');
  }

  return createReferenceRelationBuilder(target, '1:N', options);
}

function belongsTo<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, 'N:1', RelationOnFromOptions<From, To>> {
  return createReferenceRelationBuilder(target, 'N:1', options);
}

export const rel = {
  belongsTo,
  hasMany,
  hasOne,
} as const;

type ValueObjectInput<Fields extends Record<string, AnyFieldBuilder>> = {
  readonly fields: Fields;
};

export function valueObject<
  const Name extends string,
  const Fields extends Record<string, AnyFieldBuilder>,
>(name: Name, input: ValueObjectInput<Fields>): ValueObjectBuilder<Name, Fields> {
  return {
    __kind: 'valueObject',
    __name: name,
    __fields: input.fields,
  };
}

type ModelDiscriminatorInput<Variants extends Record<string, VariantSpec>> = {
  readonly field: string;
  readonly variants: Variants;
};

type ModelInput<
  Fields extends Record<string, AnyFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> | undefined,
  Collection extends string | undefined,
  Indexes extends readonly MongoIndex[] | undefined,
  CollectionOptions,
  Owner extends ModelNameInput | undefined,
  Base extends ModelNameInput | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined,
  Discriminator extends ModelDiscriminatorInput<Record<string, VariantSpec>> | undefined,
> = {
  readonly collection?: Collection;
  readonly indexes?: Indexes;
  readonly collectionOptions?: StrictShape<CollectionOptions, MongoCollectionOptions>;
  readonly storageRelations?: StorageRelations;
  readonly fields: Fields;
  readonly relations?: Relations;
  readonly owner?: Owner;
  readonly base?: Base;
  readonly discriminator?: Discriminator;
};

export function model<
  const Name extends string,
  const Fields extends Record<string, AnyFieldBuilder>,
  const Relations extends Record<string, AnyRelationBuilder> | undefined = undefined,
  const Collection extends string | undefined = undefined,
  const Indexes extends readonly MongoIndex[] | undefined = undefined,
  const CollectionOptions = undefined,
  const Owner extends ModelNameInput | undefined = undefined,
  const Base extends ModelNameInput | undefined = undefined,
  const StorageRelations extends Record<string, StorageRelationSpec> | undefined = undefined,
  const Discriminator extends
    | ModelDiscriminatorInput<Record<string, VariantSpec>>
    | undefined = undefined,
>(
  name: Name,
  input: ModelInput<
    Fields,
    Relations,
    Collection,
    Indexes,
    CollectionOptions,
    Owner,
    Base,
    StorageRelations,
    Discriminator
  >,
): ModelBuilder<
  Name,
  Fields,
  Relations extends Record<string, AnyRelationBuilder> ? Relations : Record<never, never>,
  Collection,
  NormalizeModelNameOrUndefined<Owner>,
  NormalizeModelNameOrUndefined<Base>,
  StorageRelations,
  Discriminator extends { readonly field: infer Field extends string }
    ? { readonly field: Field }
    : undefined,
  Discriminator extends { readonly variants: infer Variants extends Record<string, VariantSpec> }
    ? Variants
    : undefined
> {
  return {
    __kind: 'model',
    __name: name,
    __fields: input.fields,
    __relations: (input.relations ?? {}) as Relations extends Record<string, AnyRelationBuilder>
      ? Relations
      : Record<never, never>,
    __indexes: input.indexes,
    __collectionOptions: input.collectionOptions,
    __collection: input.collection as Collection,
    __owner: (input.owner
      ? resolveModelName(input.owner)
      : undefined) as NormalizeModelNameOrUndefined<Owner>,
    __base: (input.base
      ? resolveModelName(input.base)
      : undefined) as NormalizeModelNameOrUndefined<Base>,
    __storageRelations: input.storageRelations as StorageRelations,
    __discriminator: (input.discriminator
      ? { field: input.discriminator.field }
      : undefined) as Discriminator extends { readonly field: infer Field extends string }
      ? { readonly field: Field }
      : undefined,
    __variants: input.discriminator?.variants as Discriminator extends {
      readonly variants: infer Variants extends Record<string, VariantSpec>;
    }
      ? Variants
      : undefined,
    ref(fieldName) {
      return createFieldReference(name, fieldName);
    },
  };
}

function validateTargetPackRef(
  family: FamilyPackRef<string>,
  target: TargetPackRef<string, string>,
): void {
  if (family.familyId !== 'mongo') {
    throw new Error(
      `defineContract only accepts Mongo family packs. Received family "${family.familyId}".`,
    );
  }

  if (target.familyId !== family.familyId) {
    throw new Error(
      `target pack "${target.id}" targets family "${target.familyId}" but contract family is "${family.familyId}".`,
    );
  }
}

function validateExtensionPackRefs(
  target: TargetPackRef<string, string>,
  extensionPacks?: Record<string, ExtensionPackRef<string, string>>,
): void {
  if (!extensionPacks) {
    return;
  }

  for (const packRef of Object.values(extensionPacks)) {
    if (packRef.kind !== 'extension') {
      throw new Error(
        `defineContract only accepts extension pack refs in extensionPacks. Received kind "${packRef.kind}".`,
      );
    }

    if (packRef.familyId !== target.familyId) {
      throw new Error(
        `extension pack "${packRef.id}" targets family "${packRef.familyId}" but contract target family is "${target.familyId}".`,
      );
    }

    if (packRef.targetId && packRef.targetId !== target.targetId) {
      throw new Error(
        `extension pack "${packRef.id}" targets "${packRef.targetId}" but contract target is "${target.targetId}".`,
      );
    }
  }
}

function isContractScaffold(
  value: unknown,
): value is ContractScaffold<
  FamilyPackRef<string>,
  TargetPackRef<string, string>,
  Record<string, ExtensionPackRef<string, string>> | undefined,
  ContractCapabilities | undefined,
  Record<string, ModelNameInput> | undefined
> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return 'family' in value && 'target' in value;
}

function buildContractField(builder: AnyFieldBuilder): ContractField {
  return builder.__many
    ? {
        type: builder.__type,
        nullable: builder.__nullable,
        many: true,
      }
    : {
        type: builder.__type,
        nullable: builder.__nullable,
      };
}

function buildFields(fields: Record<string, AnyFieldBuilder>): Record<string, ContractField> {
  const builtFields: Record<string, ContractField> = {};

  for (const [fieldName, fieldBuilder] of Object.entries(fields)) {
    builtFields[fieldName] = buildContractField(fieldBuilder);
  }

  return builtFields;
}

function buildRelation(
  relationBuilder: AnyRelationBuilder,
): ContractEmbedRelation | ContractReferenceRelation {
  return relationBuilder.__on
    ? {
        to: relationBuilder.__to,
        cardinality: relationBuilder.__cardinality,
        on: relationBuilder.__on,
      }
    : {
        to: relationBuilder.__to,
        cardinality: relationBuilder.__cardinality,
      };
}

function buildRelations(
  relations: Record<string, AnyRelationBuilder>,
): Record<string, ContractEmbedRelation | ContractReferenceRelation> {
  const builtRelations: Record<string, ContractEmbedRelation | ContractReferenceRelation> = {};

  for (const [relationName, relationBuilder] of Object.entries(relations)) {
    builtRelations[relationName] = buildRelation(relationBuilder);
  }

  return builtRelations;
}

function buildValueObjects(
  valueObjects: Record<string, AnyValueObjectBuilder> | undefined,
): Record<string, ContractValueObject> {
  const builtValueObjects: Record<string, ContractValueObject> = {};

  for (const valueObjectBuilder of Object.values(valueObjects ?? {})) {
    if (valueObjectBuilder.__name in builtValueObjects) {
      throw new Error(
        `Duplicate value object name "${valueObjectBuilder.__name}" in defineContract().`,
      );
    }

    builtValueObjects[valueObjectBuilder.__name] = {
      fields: buildFields(valueObjectBuilder.__fields),
    };
  }

  return builtValueObjects;
}

function buildModels(
  models: Record<string, AnyModelBuilder> | undefined,
): Record<string, MongoContract['models'][string]> {
  const builtModels: Record<string, MongoContract['models'][string]> = {};

  for (const modelBuilder of Object.values(models ?? {})) {
    if (modelBuilder.__name in builtModels) {
      throw new Error(`Duplicate model name "${modelBuilder.__name}" in defineContract().`);
    }

    const storage = {
      ...(modelBuilder.__collection ? { collection: modelBuilder.__collection } : {}),
      ...(modelBuilder.__storageRelations ? { relations: modelBuilder.__storageRelations } : {}),
    };

    builtModels[modelBuilder.__name] = {
      fields: buildFields(modelBuilder.__fields),
      relations: buildRelations(modelBuilder.__relations),
      storage,
      ...(modelBuilder.__owner ? { owner: modelBuilder.__owner } : {}),
      ...(modelBuilder.__base ? { base: modelBuilder.__base } : {}),
      ...(modelBuilder.__discriminator ? { discriminator: modelBuilder.__discriminator } : {}),
      ...(modelBuilder.__variants ? { variants: modelBuilder.__variants } : {}),
    };
  }

  return builtModels;
}

function deriveRoots(models: Record<string, AnyModelBuilder> | undefined): Record<string, string> {
  const roots: Record<string, string> = {};

  for (const modelBuilder of Object.values(models ?? {})) {
    if (!modelBuilder.__collection || modelBuilder.__owner || modelBuilder.__base) {
      continue;
    }

    roots[modelBuilder.__collection] = modelBuilder.__name;
  }

  return roots;
}

function normalizeRoots(roots: Record<string, ModelNameInput> | undefined): Record<string, string> {
  const normalizedRoots: Record<string, string> = {};

  for (const [rootName, rootValue] of Object.entries(roots ?? {})) {
    normalizedRoots[rootName] = resolveModelName(rootValue);
  }

  return normalizedRoots;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function toStorageIndex(index: MongoIndex): MongoStorageIndex {
  const keys = Object.entries(index.fields).map(([field, direction]) => ({
    field,
    direction,
  }));
  const result: Record<string, unknown> = { keys };
  if (index.options) {
    for (const [key, value] of Object.entries(index.options)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }
  return result as unknown as MongoStorageIndex;
}

function toStorageCollectionOptions(opts: MongoCollectionOptions): MongoStorageCollectionOptions {
  const result: Record<string, unknown> = {};
  if (opts.capped) {
    result['capped'] = { size: opts.size ?? 0, ...(opts.max != null ? { max: opts.max } : {}) };
  }
  if (opts.timeseries) result['timeseries'] = opts.timeseries;
  if (opts.collation) result['collation'] = opts.collation;
  if (opts.changeStreamPreAndPostImages)
    result['changeStreamPreAndPostImages'] = opts.changeStreamPreAndPostImages;
  if (opts.clusteredIndex) result['clusteredIndex'] = { name: opts.clusteredIndex.name };
  return result as unknown as MongoStorageCollectionOptions;
}

function buildCollections(
  models: Record<string, AnyModelBuilder> | undefined,
): Record<string, MongoStorageCollection> {
  const collections: Record<string, MongoStorageCollection> = {};
  const declaredIndexOwners = new Map<string, string>();

  for (const modelBuilder of Object.values(models ?? {})) {
    if (!modelBuilder.__collection) {
      if (modelBuilder.__indexes && modelBuilder.__indexes.length > 0) {
        throw new Error(
          `Model "${modelBuilder.__name}" defines indexes but has no collection to attach them to.`,
        );
      }

      if (modelBuilder.__collectionOptions) {
        throw new Error(
          `Model "${modelBuilder.__name}" defines collectionOptions but has no collection to attach them to.`,
        );
      }

      continue;
    }

    const existingCollection = collections[modelBuilder.__collection] ?? {};
    const existingIndexes = existingCollection.indexes ?? [];

    if (existingCollection.options && modelBuilder.__collectionOptions) {
      throw new Error(
        `Collection "${modelBuilder.__collection}" has collectionOptions declared by multiple models. Author collectionOptions on a single model per collection.`,
      );
    }

    for (const collectionIndex of modelBuilder.__indexes ?? []) {
      const indexSignature = stableStringify(collectionIndex);
      const collectionIndexKey = `${modelBuilder.__collection}:${indexSignature}`;
      const firstOwner = declaredIndexOwners.get(collectionIndexKey);
      if (firstOwner) {
        throw new Error(
          `Collection "${modelBuilder.__collection}" defines duplicate index ${indexSignature}. First declared on model "${firstOwner}" and duplicated on model "${modelBuilder.__name}".`,
        );
      }
      declaredIndexOwners.set(collectionIndexKey, modelBuilder.__name);
    }

    const storageIndexes = (modelBuilder.__indexes ?? []).map(toStorageIndex);
    const storageOptions = modelBuilder.__collectionOptions
      ? toStorageCollectionOptions(modelBuilder.__collectionOptions)
      : undefined;

    collections[modelBuilder.__collection] =
      storageIndexes.length > 0
        ? {
            ...existingCollection,
            indexes: [...existingIndexes, ...storageIndexes],
            ...(storageOptions ? { options: storageOptions } : {}),
          }
        : storageOptions
          ? {
              ...existingCollection,
              options: storageOptions,
            }
          : existingCollection;
  }

  return collections;
}

function buildContractFromDefinition<
  const Definition extends ContractDefinition<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    ContractCapabilities | undefined,
    Record<string, ModelNameInput> | undefined
  >,
>(definition: Definition): MongoContractResult<Definition> {
  validateTargetPackRef(definition.family, definition.target);
  validateExtensionPackRefs(definition.target, definition.extensionPacks);

  const builtModels = buildModels(definition.models);
  const builtValueObjects = buildValueObjects(definition.valueObjects);
  const roots = definition.roots
    ? normalizeRoots(definition.roots)
    : deriveRoots(definition.models);
  const capabilities = definition.capabilities ?? {};
  const collections = buildCollections(definition.models);
  const storageBody = {
    collections,
  };

  const builtContract = {
    target: definition.target.targetId,
    targetFamily: definition.family.familyId,
    roots,
    models: builtModels,
    ...(Object.keys(builtValueObjects).length > 0 ? { valueObjects: builtValueObjects } : {}),
    storage: {
      ...storageBody,
      storageHash: computeStorageHash({
        target: definition.target.targetId,
        targetFamily: definition.family.familyId,
        storage: storageBody,
      }),
    },
    capabilities,
    extensionPacks: definition.extensionPacks ?? {},
    profileHash: computeProfileHash({
      target: definition.target.targetId,
      targetFamily: definition.family.familyId,
      capabilities,
    }),
    meta: {},
  } satisfies MongoContract;

  validateMongoContract(builtContract);

  return builtContract as MongoContractResult<Definition>;
}

export function defineContract<
  const Definition extends ContractDefinition<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    ContractCapabilities | undefined,
    Record<string, ModelNameInput> | undefined
  >,
>(definition: Definition): MongoContractResult<Definition>;
export function defineContract<
  const Definition extends ContractScaffold<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    ContractCapabilities | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  const Built extends {
    readonly models?: Record<string, AnyModelBuilder>;
    readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
    readonly roots?: Record<string, ModelNameInput>;
  },
>(
  definition: Definition,
  factory: (_helpers: ContractAuthoringHelpers) => Built,
): MongoContractResult<Definition & Built>;
export function defineContract(
  definition: ContractScaffold<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    ContractCapabilities | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  factory?: ContractFactory<
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ModelNameInput> | undefined
  >,
) {
  if (!isContractScaffold(definition)) {
    throw new TypeError(
      'defineContract expects a contract definition object. Define your contract with defineContract({ family, target, models, ... }).',
    );
  }

  if (!factory) {
    return buildContractFromDefinition(definition);
  }

  return buildContractFromDefinition({
    ...definition,
    ...factory({ field, index, model, rel, valueObject }),
  });
}
