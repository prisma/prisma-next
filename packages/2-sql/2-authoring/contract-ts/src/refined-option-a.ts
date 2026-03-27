import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import type {
  ColumnTypeDescriptor,
  ForeignKeyDefaultsState,
} from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';

export type NamingStrategy = 'identity' | 'snake_case';

export type NamingConfig = {
  readonly tables?: NamingStrategy;
  readonly columns?: NamingStrategy;
};

type NamedConstraintSpec<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

export type ScalarFieldState<
  CodecId extends string = string,
  Nullable extends boolean = boolean,
  ColumnName extends string | undefined = string | undefined,
  IdSpec extends NamedConstraintSpec | undefined = undefined,
  UniqueSpec extends NamedConstraintSpec | undefined = undefined,
> = {
  readonly kind: 'scalar';
  readonly descriptor?: (ColumnTypeDescriptor & { readonly codecId: CodecId }) | undefined;
  readonly typeRef?: string | undefined;
  readonly nullable: Nullable;
  readonly columnName?: ColumnName | undefined;
  readonly default?: ColumnDefault | undefined;
  readonly executionDefault?: ExecutionMutationDefaultValue | undefined;
} & (IdSpec extends NamedConstraintSpec ? { readonly id: IdSpec } : { readonly id?: undefined }) &
  (UniqueSpec extends NamedConstraintSpec
    ? { readonly unique: UniqueSpec }
    : { readonly unique?: undefined });

export type GeneratedFieldSpec = {
  readonly type: ColumnTypeDescriptor;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

type AnyScalarFieldState = ScalarFieldState<
  string,
  boolean,
  string | undefined,
  NamedConstraintSpec | undefined,
  NamedConstraintSpec | undefined
>;

function isColumnDefault(value: unknown): value is ColumnDefault {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'literal' || kind === 'function';
}

function toColumnDefault(value: ColumnDefaultLiteralInputValue | ColumnDefault): ColumnDefault {
  if (isColumnDefault(value)) {
    return value;
  }
  return { kind: 'literal', value };
}

export class ScalarFieldBuilder<State extends ScalarFieldState = AnyScalarFieldState> {
  declare readonly __state: State;

  constructor(private readonly state: State) {}

  optional(): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      boolean,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, true, ColumnName, IdSpec, UniqueSpec>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      nullable: true,
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      boolean,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, true, ColumnName, IdSpec, UniqueSpec>
      : never);
  }

  column<ColumnName extends string>(
    name: ColumnName,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      string | undefined,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, IdSpec, UniqueSpec>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      columnName: name,
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      string | undefined,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, IdSpec, UniqueSpec>
      : never);
  }

  default(value: ColumnDefaultLiteralInputValue | ColumnDefault): ScalarFieldBuilder<State> {
    return new ScalarFieldBuilder({
      ...this.state,
      default: toColumnDefault(value),
    }) as ScalarFieldBuilder<State>;
  }

  defaultSql(expression: string): ScalarFieldBuilder<State> {
    return new ScalarFieldBuilder({
      ...this.state,
      default: { kind: 'function', expression },
    }) as ScalarFieldBuilder<State>;
  }

  id<const Name extends string | undefined = undefined>(
    options?: NamedConstraintSpec<Name>,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      infer ColumnName,
      NamedConstraintSpec | undefined,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, NamedConstraintSpec<Name>, UniqueSpec>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      id: options?.name ? { name: options.name } : {},
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      infer ColumnName,
      NamedConstraintSpec | undefined,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, NamedConstraintSpec<Name>, UniqueSpec>
      : never);
  }

  unique<const Name extends string | undefined = undefined>(
    options?: NamedConstraintSpec<Name>,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      NamedConstraintSpec | undefined
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, IdSpec, NamedConstraintSpec<Name>>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      unique: options?.name ? { name: options.name } : {},
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      NamedConstraintSpec | undefined
    >
      ? ScalarFieldState<CodecId, Nullable, ColumnName, IdSpec, NamedConstraintSpec<Name>>
      : never);
  }

  build(): State {
    return this.state;
  }
}

type LazyRelationModelName<ModelName extends string = string> = {
  readonly kind: 'lazyRelationModelName';
  readonly resolve: () => ModelName;
};

type RelationModelSource<ModelName extends string = string> =
  | ModelName
  | LazyRelationModelName<ModelName>;

type BelongsToRelation<
  ToModel extends string = string,
  FromField extends string | readonly string[] = string | readonly string[],
  ToField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'belongsTo';
  readonly toModel: RelationModelSource<ToModel>;
  readonly from: FromField;
  readonly to: ToField;
};

type HasManyRelation<
  ToModel extends string = string,
  ByField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'hasMany';
  readonly toModel: RelationModelSource<ToModel>;
  readonly by: ByField;
};

type HasOneRelation<
  ToModel extends string = string,
  ByField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'hasOne';
  readonly toModel: RelationModelSource<ToModel>;
  readonly by: ByField;
};

type ManyToManyRelation<
  ToModel extends string = string,
  ThroughModel extends string = string,
  FromField extends string | readonly string[] = string | readonly string[],
  ToField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'manyToMany';
  readonly toModel: RelationModelSource<ToModel>;
  readonly through: RelationModelSource<ThroughModel>;
  readonly from: FromField;
  readonly to: ToField;
};

export type RelationState =
  | BelongsToRelation
  | HasManyRelation
  | HasOneRelation
  | ManyToManyRelation;

export type ColumnRef<FieldName extends string = string> = {
  readonly kind: 'columnRef';
  readonly fieldName: FieldName;
};

export type TargetFieldRef<ModelName extends string = string, FieldName extends string = string> = {
  readonly kind: 'targetFieldRef';
  readonly modelName: ModelName;
  readonly fieldName: FieldName;
};

export type ModelTokenRefs<
  ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
> = {
  readonly [K in keyof Fields]: TargetFieldRef<ModelName, K & string>;
};

type ConstraintOptions = {
  readonly name?: string;
};

type IndexOptions = ConstraintOptions & {
  readonly using?: string;
  readonly config?: Record<string, unknown>;
};

type ForeignKeyOptions = ConstraintOptions & {
  readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly constraint?: boolean;
  readonly index?: boolean;
};

export type IdConstraint<
  FieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = {
  readonly kind: 'id';
  readonly fields: FieldNames;
  readonly name?: Name;
};

export type UniqueConstraint<FieldNames extends readonly string[] = readonly string[]> = {
  readonly kind: 'unique';
  readonly fields: FieldNames;
  readonly name?: string;
};

export type IndexConstraint<FieldNames extends readonly string[] = readonly string[]> = {
  readonly kind: 'index';
  readonly fields: FieldNames;
  readonly name?: string;
  readonly using?: string;
  readonly config?: Record<string, unknown>;
};

export type ForeignKeyConstraint<
  SourceFieldNames extends readonly string[] = readonly string[],
  TargetModelName extends string = string,
  TargetFieldNames extends readonly string[] = readonly string[],
> = {
  readonly kind: 'fk';
  readonly fields: SourceFieldNames;
  readonly targetModel: TargetModelName;
  readonly targetFields: TargetFieldNames;
  readonly name?: string;
  readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly constraint?: boolean;
  readonly index?: boolean;
};

function normalizeFieldRefInput(input: ColumnRef | readonly ColumnRef[]): readonly string[] {
  return (Array.isArray(input) ? input : [input]).map((ref) => ref.fieldName);
}

function normalizeTargetFieldRefInput(input: TargetFieldRef | readonly TargetFieldRef[]): {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
} {
  const refs = Array.isArray(input) ? input : [input];
  const [first] = refs;
  if (!first) {
    throw new Error('Expected at least one target ref');
  }
  if (refs.some((ref) => ref.modelName !== first.modelName)) {
    throw new Error('All target refs in a foreign key must point to the same model');
  }
  return {
    modelName: first.modelName,
    fieldNames: refs.map((ref) => ref.fieldName),
  };
}

function createConstraintsDsl() {
  function ref<ModelName extends string, FieldName extends string>(
    modelName: ModelName,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName, FieldName> {
    return {
      kind: 'targetFieldRef',
      modelName,
      fieldName,
    };
  }

  function id<FieldName extends string, Name extends string | undefined = undefined>(
    field: ColumnRef<FieldName>,
    options?: NamedConstraintSpec<Name>,
  ): IdConstraint<readonly [FieldName], Name>;
  function id<FieldNames extends readonly string[], Name extends string | undefined = undefined>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: NamedConstraintSpec<Name>,
  ): IdConstraint<FieldNames, Name>;
  function id(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    options?: NamedConstraintSpec,
  ): IdConstraint {
    return {
      kind: 'id',
      fields: normalizeFieldRefInput(fieldOrFields),
      ...(options?.name ? { name: options.name } : {}),
    };
  }

  function unique<FieldName extends string>(
    field: ColumnRef<FieldName>,
    options?: ConstraintOptions,
  ): UniqueConstraint<readonly [FieldName]>;
  function unique<FieldNames extends readonly string[]>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: ConstraintOptions,
  ): UniqueConstraint<FieldNames>;
  function unique(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    options?: ConstraintOptions,
  ): UniqueConstraint {
    return {
      kind: 'unique',
      fields: normalizeFieldRefInput(fieldOrFields),
      ...(options?.name ? { name: options.name } : {}),
    };
  }

  function index<FieldName extends string>(
    field: ColumnRef<FieldName>,
    options?: IndexOptions,
  ): IndexConstraint<readonly [FieldName]>;
  function index<FieldNames extends readonly string[]>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: IndexOptions,
  ): IndexConstraint<FieldNames>;
  function index(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    options?: IndexOptions,
  ): IndexConstraint {
    return {
      kind: 'index',
      fields: normalizeFieldRefInput(fieldOrFields),
      ...(options?.name ? { name: options.name } : {}),
      ...(options?.using ? { using: options.using } : {}),
      ...(options?.config ? { config: options.config } : {}),
    };
  }

  function foreignKey<
    SourceFieldName extends string,
    TargetModelName extends string,
    TargetFieldName extends string,
  >(
    field: ColumnRef<SourceFieldName>,
    target: TargetFieldRef<TargetModelName, TargetFieldName>,
    options?: ForeignKeyOptions,
  ): ForeignKeyConstraint<readonly [SourceFieldName], TargetModelName, readonly [TargetFieldName]>;
  function foreignKey<
    SourceFieldNames extends readonly string[],
    TargetModelName extends string,
    TargetFieldNames extends readonly string[],
  >(
    fields: { readonly [K in keyof SourceFieldNames]: ColumnRef<SourceFieldNames[K] & string> },
    target: {
      readonly [K in keyof TargetFieldNames]: TargetFieldRef<
        TargetModelName,
        TargetFieldNames[K] & string
      >;
    },
    options?: ForeignKeyOptions,
  ): ForeignKeyConstraint<SourceFieldNames, TargetModelName, TargetFieldNames>;
  function foreignKey(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    target: TargetFieldRef | readonly TargetFieldRef[],
    options?: ForeignKeyOptions,
  ): ForeignKeyConstraint {
    const normalizedTarget = normalizeTargetFieldRefInput(target);
    return {
      kind: 'fk',
      fields: normalizeFieldRefInput(fieldOrFields),
      targetModel: normalizedTarget.modelName,
      targetFields: normalizedTarget.fieldNames,
      ...(options?.name ? { name: options.name } : {}),
      ...(options?.onDelete ? { onDelete: options.onDelete } : {}),
      ...(options?.onUpdate ? { onUpdate: options.onUpdate } : {}),
      ...(options?.constraint !== undefined ? { constraint: options.constraint } : {}),
      ...(options?.index !== undefined ? { index: options.index } : {}),
    };
  }

  return {
    ref,
    id,
    unique,
    index,
    foreignKey,
  };
}

export type ConstraintsDsl = ReturnType<typeof createConstraintsDsl>;

export type ModelAttributesSpec = {
  readonly id?: IdConstraint;
  readonly uniques?: readonly UniqueConstraint[];
};

export type SqlStageSpec = {
  readonly table?: string;
  readonly indexes?: readonly IndexConstraint[];
  readonly foreignKeys?: readonly ForeignKeyConstraint[];
};

type FieldRefs<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly [K in keyof Fields]: ColumnRef<K & string>;
};

type AttributeContext<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly fields: FieldRefs<Fields>;
  readonly constraints: Pick<ConstraintsDsl, 'id' | 'unique'>;
};

type SqlContext<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly cols: FieldRefs<Fields>;
  readonly constraints: Pick<ConstraintsDsl, 'index' | 'foreignKey' | 'ref'>;
};

function createFieldRefs<Fields extends Record<string, ScalarFieldBuilder>>(
  fields: Fields,
): FieldRefs<Fields> {
  const refs = {} as Record<string, ColumnRef>;
  for (const fieldName of Object.keys(fields)) {
    refs[fieldName] = { kind: 'columnRef', fieldName };
  }
  return refs as FieldRefs<Fields>;
}

function createModelTokenRefs<
  ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
>(modelName: ModelName, fields: Fields): ModelTokenRefs<ModelName, Fields> {
  const refs = {} as Record<string, TargetFieldRef>;
  for (const fieldName of Object.keys(fields)) {
    refs[fieldName] = {
      kind: 'targetFieldRef',
      modelName,
      fieldName,
    };
  }
  return refs as ModelTokenRefs<ModelName, Fields>;
}

type StageInput<Context, Spec> = Spec | ((context: Context) => Spec);

function buildStageSpec<Context, Spec>(
  stageInput: StageInput<Context, Spec>,
  context: Context,
): Spec {
  if (typeof stageInput === 'function') {
    return (stageInput as (context: Context) => Spec)(context);
  }
  return stageInput;
}

function createAttributeConstraintsDsl(): AttributeContext<
  Record<string, ScalarFieldBuilder>
>['constraints'] {
  const constraints = createConstraintsDsl();
  return {
    id: constraints.id,
    unique: constraints.unique,
  };
}

function createSqlConstraintsDsl(): SqlContext<Record<string, ScalarFieldBuilder>>['constraints'] {
  const constraints = createConstraintsDsl();
  return {
    index: constraints.index,
    foreignKey: constraints.foreignKey,
    ref: constraints.ref,
  };
}

function createColumnRefs<Fields extends Record<string, ScalarFieldBuilder>>(
  fields: Fields,
): SqlContext<Fields>['cols'] {
  return createFieldRefs(fields);
}

export class RefinedModelBuilder<
  ModelName extends string | undefined,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, RelationState> = Record<never, never>,
  AttributesSpec extends ModelAttributesSpec | undefined = undefined,
  SqlSpec extends SqlStageSpec | undefined = undefined,
> {
  declare readonly __name: ModelName;
  declare readonly __fields: Fields;
  declare readonly __relations: Relations;
  declare readonly __attributes: AttributesSpec;
  declare readonly __sql: SqlSpec;
  readonly refs: ModelName extends string ? ModelTokenRefs<ModelName, Fields> : never;

  constructor(
    readonly stageOne: {
      readonly modelName?: ModelName;
      readonly fields: Fields;
      readonly relations: Relations;
    },
    readonly attributesFactory?: StageInput<AttributeContext<Fields>, AttributesSpec>,
    readonly sqlFactory?: StageInput<SqlContext<Fields>, SqlSpec>,
  ) {
    this.refs = (
      stageOne.modelName ? createModelTokenRefs(stageOne.modelName, stageOne.fields) : undefined
    ) as ModelName extends string ? ModelTokenRefs<ModelName, Fields> : never;
  }

  ref<FieldName extends keyof Fields & string>(
    this: ModelName extends string
      ? RefinedModelBuilder<ModelName, Fields, Relations, AttributesSpec, SqlSpec>
      : never,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName & string, FieldName> {
    const modelName = this.stageOne.modelName;
    if (!modelName) {
      throw new Error('Model tokens require model("ModelName", ...) before calling .ref(...)');
    }

    return {
      kind: 'targetFieldRef',
      modelName,
      fieldName,
    } as TargetFieldRef<ModelName & string, FieldName>;
  }

  relations<const NextRelations extends Record<string, RelationState>>(
    relations: NextRelations,
  ): RefinedModelBuilder<ModelName, Fields, Relations & NextRelations, AttributesSpec, SqlSpec> {
    return new RefinedModelBuilder(
      {
        ...this.stageOne,
        relations: {
          ...this.stageOne.relations,
          ...relations,
        } as Relations & NextRelations,
      },
      this.attributesFactory,
      this.sqlFactory,
    );
  }

  attributes<const NextAttributesSpec extends ModelAttributesSpec>(
    specOrFactory: StageInput<AttributeContext<Fields>, NextAttributesSpec>,
  ): RefinedModelBuilder<ModelName, Fields, Relations, NextAttributesSpec, SqlSpec> {
    return new RefinedModelBuilder(this.stageOne, specOrFactory, this.sqlFactory);
  }

  sql<const NextSqlSpec extends SqlStageSpec>(
    specOrFactory: StageInput<SqlContext<Fields>, NextSqlSpec>,
  ): RefinedModelBuilder<ModelName, Fields, Relations, AttributesSpec, NextSqlSpec> {
    return new RefinedModelBuilder(this.stageOne, this.attributesFactory, specOrFactory);
  }

  buildAttributesSpec(): AttributesSpec {
    if (!this.attributesFactory) {
      return undefined as AttributesSpec;
    }

    return buildStageSpec(this.attributesFactory, {
      fields: createFieldRefs(this.stageOne.fields),
      constraints: createAttributeConstraintsDsl() as AttributeContext<Fields>['constraints'],
    });
  }

  buildSqlSpec(): SqlSpec {
    if (!this.sqlFactory) {
      return undefined as SqlSpec;
    }
    return buildStageSpec(this.sqlFactory, {
      cols: createColumnRefs(this.stageOne.fields),
      constraints: createSqlConstraintsDsl() as SqlContext<Fields>['constraints'],
    });
  }
}

type NamedModelTokenShape<
  ModelName extends string = string,
  Fields extends Record<string, ScalarFieldBuilder> = Record<string, ScalarFieldBuilder>,
> = {
  readonly stageOne: {
    readonly modelName?: ModelName;
    readonly fields: Fields;
  };
};

type AnyNamedModelToken = NamedModelTokenShape<string, Record<string, ScalarFieldBuilder>>;

type LazyNamedModelToken<Token extends AnyNamedModelToken = AnyNamedModelToken> = () => Token;

type RelationFieldSelection<FieldName extends string> = FieldName | readonly FieldName[];

type RelationModelName<Target> =
  Target extends NamedModelTokenShape<
    infer ModelName extends string,
    Record<string, ScalarFieldBuilder>
  >
    ? ModelName
    : Target extends () => infer Token
      ? RelationModelName<Token>
      : never;

type RelationModelFieldNames<Target> =
  Target extends NamedModelTokenShape<string, infer Fields>
    ? keyof Fields & string
    : Target extends () => infer Token
      ? RelationModelFieldNames<Token>
      : never;

function isLazyRelationModelName(value: unknown): value is LazyRelationModelName<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: unknown }).kind === 'lazyRelationModelName' &&
    'resolve' in value &&
    typeof (value as { resolve?: unknown }).resolve === 'function'
  );
}

function resolveNamedModelTokenName(token: {
  readonly stageOne: {
    readonly modelName?: string | undefined;
  };
}): string {
  const modelName = token.stageOne.modelName;
  if (!modelName) {
    throw new Error(
      'Relation targets require named model tokens. Use model("ModelName", ...) before passing a token to rel.*(...).',
    );
  }
  return modelName;
}

function normalizeRelationModelSource<Token extends AnyNamedModelToken>(
  target: Token | LazyNamedModelToken<Token>,
): RelationModelSource<RelationModelName<Token>>;
function normalizeRelationModelSource<ToModel extends string>(
  target: ToModel,
): RelationModelSource<ToModel>;
function normalizeRelationModelSource(
  target: string | AnyNamedModelToken | LazyNamedModelToken,
): RelationModelSource<string> {
  if (typeof target === 'string') {
    return target;
  }

  if (typeof target === 'function') {
    return {
      kind: 'lazyRelationModelName',
      resolve: () => resolveNamedModelTokenName(target()),
    };
  }

  return resolveNamedModelTokenName(target);
}

export type RefinedContractInput<
  Target extends TargetPackRef<'sql', string> = TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  Models extends Record<
    string,
    RefinedModelBuilder<
      string | undefined,
      Record<string, ScalarFieldBuilder>,
      Record<string, RelationState>,
      ModelAttributesSpec | undefined,
      SqlStageSpec | undefined
    >
  > = Record<never, never>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> = {
  readonly target: Target;
  readonly extensionPacks?: ExtensionPacks;
  readonly naming?: NamingConfig;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly capabilities?: Capabilities;
  readonly types?: Types;
  readonly models?: Models;
};

export function model<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, RelationState> = Record<never, never>,
>(
  modelName: ModelName,
  input: {
    readonly fields: Fields;
    readonly relations?: Relations;
  },
): RefinedModelBuilder<ModelName, Fields, Relations>;

export function model<
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, RelationState> = Record<never, never>,
>(input: {
  readonly fields: Fields;
  readonly relations?: Relations;
}): RefinedModelBuilder<undefined, Fields, Relations>;

export function model<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, RelationState> = Record<never, never>,
>(
  modelNameOrInput:
    | ModelName
    | {
        readonly fields: Fields;
        readonly relations?: Relations;
      },
  maybeInput?: {
    readonly fields: Fields;
    readonly relations?: Relations;
  },
): RefinedModelBuilder<ModelName | undefined, Fields, Relations> {
  const input = typeof modelNameOrInput === 'string' ? maybeInput : modelNameOrInput;

  if (!input) {
    throw new Error('model("ModelName", ...) requires a model definition.');
  }

  return new RefinedModelBuilder({
    ...(typeof modelNameOrInput === 'string' ? { modelName: modelNameOrInput } : {}),
    fields: input.fields,
    relations: (input.relations ?? {}) as Relations,
  });
}

function belongsTo<
  Token extends AnyNamedModelToken,
  FromField extends string | readonly string[],
  ToField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly from: FromField; readonly to: ToField },
): BelongsToRelation<RelationModelName<Token>, FromField, ToField>;
function belongsTo<
  ToModel extends string,
  FromField extends string | readonly string[],
  ToField extends string | readonly string[],
>(
  toModel: ToModel,
  options: { readonly from: FromField; readonly to: ToField },
): BelongsToRelation<ToModel, FromField, ToField>;
function belongsTo(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): BelongsToRelation {
  return {
    kind: 'belongsTo',
    toModel: normalizeRelationModelSource(toModel),
    from: options.from,
    to: options.to,
  };
}

function hasMany<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): HasManyRelation<RelationModelName<Token>, ByField>;
function hasMany<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): HasManyRelation<ToModel, ByField>;
function hasMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): HasManyRelation {
  return {
    kind: 'hasMany',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  };
}

function hasOne<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): HasOneRelation<RelationModelName<Token>, ByField>;
function hasOne<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): HasOneRelation<ToModel, ByField>;
function hasOne(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): HasOneRelation {
  return {
    kind: 'hasOne',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  };
}

function manyToMany<
  ToToken extends AnyNamedModelToken,
  ThroughToken extends AnyNamedModelToken,
  FromField extends RelationFieldSelection<RelationModelFieldNames<ThroughToken>>,
  ToField extends RelationFieldSelection<RelationModelFieldNames<ThroughToken>>,
>(
  toModel: ToToken | LazyNamedModelToken<ToToken>,
  options: {
    readonly through: ThroughToken | LazyNamedModelToken<ThroughToken>;
    readonly from: FromField;
    readonly to: ToField;
  },
): ManyToManyRelation<
  RelationModelName<ToToken>,
  RelationModelName<ThroughToken>,
  FromField,
  ToField
>;
function manyToMany<
  ToModel extends string,
  ThroughModel extends string,
  FromField extends string | readonly string[],
  ToField extends string | readonly string[],
>(
  toModel: ToModel,
  options: {
    readonly through: ThroughModel;
    readonly from: FromField;
    readonly to: ToField;
  },
): ManyToManyRelation<ToModel, ThroughModel, FromField, ToField>;
function manyToMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly through: string | AnyNamedModelToken | LazyNamedModelToken;
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): ManyToManyRelation {
  return {
    kind: 'manyToMany',
    toModel: normalizeRelationModelSource(toModel),
    through: normalizeRelationModelSource(options.through),
    from: options.from,
    to: options.to,
  };
}

export const rel = {
  belongsTo,
  hasMany,
  hasOne,
  manyToMany,
};

export const field = {
  column<Descriptor extends ColumnTypeDescriptor>(
    descriptor: Descriptor,
  ): ScalarFieldBuilder<ScalarFieldState<Descriptor['codecId'], false, undefined>> {
    return new ScalarFieldBuilder({
      kind: 'scalar',
      descriptor,
      nullable: false,
    });
  },

  generated<Descriptor extends ColumnTypeDescriptor>(
    spec: GeneratedFieldSpec & { readonly type: Descriptor },
  ): ScalarFieldBuilder<ScalarFieldState<Descriptor['codecId'], false, undefined>> {
    return new ScalarFieldBuilder({
      kind: 'scalar',
      descriptor: {
        ...spec.type,
        ...(spec.typeParams ? { typeParams: spec.typeParams } : {}),
      },
      nullable: false,
      executionDefault: spec.generated,
    });
  },

  namedType<TypeRef extends string>(
    typeRef: TypeRef,
  ): ScalarFieldBuilder<ScalarFieldState<string, false, undefined>> {
    return new ScalarFieldBuilder({
      kind: 'scalar',
      typeRef,
      nullable: false,
    });
  },
};

export function isRefinedContractInput(value: unknown): value is RefinedContractInput {
  return typeof value === 'object' && value !== null && 'target' in value;
}

function isRelationFieldArray(value: string | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

export function normalizeRelationFieldNames(value: string | readonly string[]): readonly string[] {
  if (isRelationFieldArray(value)) {
    return value;
  }
  return [value];
}

export function resolveRelationModelName(value: RelationModelSource<string>): string {
  if (isLazyRelationModelName(value)) {
    return value.resolve();
  }
  return value;
}

export function applyNaming(name: string, strategy: NamingStrategy | undefined): string {
  if (!strategy || strategy === 'identity') {
    return name;
  }

  let result = '';
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index];
    if (!char) continue;
    const lower = char.toLowerCase();
    const isUpper = char !== lower;
    if (isUpper && index > 0) {
      const prev = name[index - 1];
      const next = name[index + 1];
      const prevIsLower = !!prev && prev === prev.toLowerCase();
      const nextIsLower = !!next && next === next.toLowerCase();
      if (prevIsLower || nextIsLower) {
        result += '_';
      }
    }
    result += lower;
  }
  return result;
}

export type FieldStateOf<T> = T extends ScalarFieldBuilder<infer State> ? State : never;

export type ModelFieldsOf<T> =
  T extends RefinedModelBuilder<
    string | undefined,
    infer Fields,
    Record<string, RelationState>,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Fields
    : never;

export type ModelRelationsOf<T> =
  T extends RefinedModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    infer Relations,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Relations
    : never;

export type ModelAttributesOf<T> =
  T extends RefinedModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, RelationState>,
    infer AttributesSpec,
    SqlStageSpec | undefined
  >
    ? AttributesSpec
    : undefined;

export type ModelSqlOf<T> =
  T extends RefinedModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, RelationState>,
    ModelAttributesSpec | undefined,
    infer SqlSpec
  >
    ? SqlSpec
    : undefined;

export type IdFieldNames<T> =
  T extends IdConstraint<infer FieldNames> ? FieldNames : readonly string[];

export type AttributeStageIdFieldNames<T> = T extends { readonly id?: infer I }
  ? I extends IdConstraint
    ? IdFieldNames<I>
    : undefined
  : undefined;
