import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultValue,
} from '@prisma-next/contract/types';
import type {
  ColumnTypeDescriptor,
  ForeignKeyDefaultsState,
} from '@prisma-next/contract-authoring';
import type { AuthoringFieldPresetDescriptor } from '@prisma-next/framework-components/authoring';
import { instantiateAuthoringFieldPreset } from '@prisma-next/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { NamedConstraintSpec } from './authoring-type-utils';

export type NamingStrategy = 'identity' | 'snake_case';

export type NamingConfig = {
  readonly tables?: NamingStrategy;
  readonly columns?: NamingStrategy;
};

type NamedStorageTypeRef = string | StorageTypeInstance;

type NamedConstraintNameSpec<Name extends string = string> = {
  readonly name: Name;
};

export type ScalarFieldState<
  CodecId extends string = string,
  TypeRef extends NamedStorageTypeRef | undefined = undefined,
  Nullable extends boolean = boolean,
  ColumnName extends string | undefined = string | undefined,
  IdSpec extends NamedConstraintSpec | undefined = undefined,
  UniqueSpec extends NamedConstraintSpec | undefined = undefined,
> = {
  readonly kind: 'scalar';
  readonly descriptor?: (ColumnTypeDescriptor & { readonly codecId: CodecId }) | undefined;
  readonly typeRef?: TypeRef | undefined;
  readonly nullable: Nullable;
  readonly columnName?: ColumnName | undefined;
  readonly default?: ColumnDefault | undefined;
  readonly executionDefault?: ExecutionMutationDefaultValue | undefined;
} & (IdSpec extends NamedConstraintSpec ? { readonly id: IdSpec } : { readonly id?: undefined }) &
  (UniqueSpec extends NamedConstraintSpec
    ? { readonly unique: UniqueSpec }
    : { readonly unique?: undefined });

type AnyScalarFieldState = {
  readonly kind: 'scalar';
  readonly descriptor?: (ColumnTypeDescriptor & { readonly codecId: string }) | undefined;
  readonly typeRef?: NamedStorageTypeRef | undefined;
  readonly nullable: boolean;
  readonly columnName?: string | undefined;
  readonly default?: ColumnDefault | undefined;
  readonly executionDefault?: ExecutionMutationDefaultValue | undefined;
  readonly id?: NamedConstraintSpec | undefined;
  readonly unique?: NamedConstraintSpec | undefined;
};

type HasNamedConstraintId<State extends AnyScalarFieldState> =
  State extends ScalarFieldState<
    string,
    NamedStorageTypeRef | undefined,
    boolean,
    string | undefined,
    infer IdSpec,
    NamedConstraintSpec | undefined
  >
    ? IdSpec extends NamedConstraintSpec
      ? true
      : false
    : false;

type HasNamedConstraintUnique<State extends AnyScalarFieldState> =
  State extends ScalarFieldState<
    string,
    NamedStorageTypeRef | undefined,
    boolean,
    string | undefined,
    NamedConstraintSpec | undefined,
    infer UniqueSpec
  >
    ? UniqueSpec extends NamedConstraintSpec
      ? true
      : false
    : false;

type FieldSqlSpecForState<State extends AnyScalarFieldState> = {
  readonly column?: string;
} & (HasNamedConstraintId<State> extends true
  ? { readonly id?: NamedConstraintNameSpec }
  : Record<never, never>) &
  (HasNamedConstraintUnique<State> extends true
    ? { readonly unique?: NamedConstraintNameSpec }
    : Record<never, never>);

type ApplyFieldSqlSpec<
  State extends AnyScalarFieldState,
  Spec extends FieldSqlSpecForState<State>,
> = State extends ScalarFieldState<
  infer CodecId,
  infer TypeRef,
  infer Nullable,
  infer ColumnName,
  infer IdSpec,
  infer UniqueSpec
>
  ? ScalarFieldState<
      CodecId,
      TypeRef,
      Nullable,
      Spec extends { readonly column: infer NextColumn extends string } ? NextColumn : ColumnName,
      Spec extends { readonly id: { readonly name: infer IdName extends string } }
        ? IdSpec extends NamedConstraintSpec
          ? NamedConstraintSpec<IdName>
          : IdSpec
        : IdSpec,
      Spec extends { readonly unique: { readonly name: infer UniqueName extends string } }
        ? UniqueSpec extends NamedConstraintSpec
          ? NamedConstraintSpec<UniqueName>
          : UniqueSpec
        : UniqueSpec
    >
  : never;

export type GeneratedFieldSpec = {
  readonly type: ColumnTypeDescriptor;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

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

// Chaining methods use `as unknown as <ConditionalType>` because TypeScript cannot
// narrow generic conditional return types through object spread. The runtime values
// are correct — the casts bridge the gap between the spread result and the
// compile-time conditional type that encodes the state transition.
export class ScalarFieldBuilder<State extends AnyScalarFieldState = AnyScalarFieldState> {
  declare readonly __state: State;

  constructor(private readonly state: State) {}

  optional(): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      boolean,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, TypeRef, true, ColumnName, IdSpec, UniqueSpec>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      nullable: true,
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      boolean,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, TypeRef, true, ColumnName, IdSpec, UniqueSpec>
      : never);
  }

  column<ColumnName extends string>(
    name: ColumnName,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      infer Nullable,
      string | undefined,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      columnName: name,
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      infer Nullable,
      string | undefined,
      infer IdSpec,
      infer UniqueSpec
    >
      ? ScalarFieldState<CodecId, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec>
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
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      NamedConstraintSpec | undefined,
      infer UniqueSpec
    >
      ? ScalarFieldState<
          CodecId,
          TypeRef,
          Nullable,
          ColumnName,
          NamedConstraintSpec<Name>,
          UniqueSpec
        >
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      id: options?.name ? { name: options.name } : {},
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      NamedConstraintSpec | undefined,
      infer UniqueSpec
    >
      ? ScalarFieldState<
          CodecId,
          TypeRef,
          Nullable,
          ColumnName,
          NamedConstraintSpec<Name>,
          UniqueSpec
        >
      : never);
  }

  unique<const Name extends string | undefined = undefined>(
    options?: NamedConstraintSpec<Name>,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      NamedConstraintSpec | undefined
    >
      ? ScalarFieldState<CodecId, TypeRef, Nullable, ColumnName, IdSpec, NamedConstraintSpec<Name>>
      : never
  > {
    return new ScalarFieldBuilder({
      ...this.state,
      unique: options?.name ? { name: options.name } : {},
    } as unknown as State extends ScalarFieldState<
      infer CodecId,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      NamedConstraintSpec | undefined
    >
      ? ScalarFieldState<CodecId, TypeRef, Nullable, ColumnName, IdSpec, NamedConstraintSpec<Name>>
      : never);
  }

  sql<const Spec extends FieldSqlSpecForState<State>>(
    spec: Spec,
  ): ScalarFieldBuilder<ApplyFieldSqlSpec<State, Spec>> {
    const idSpec = 'id' in spec ? spec.id : undefined;
    const uniqueSpec = 'unique' in spec ? spec.unique : undefined;

    if (idSpec && !this.state.id) {
      throw new Error('field.sql({ id }) requires an existing inline .id(...) declaration.');
    }
    if (uniqueSpec && !this.state.unique) {
      throw new Error(
        'field.sql({ unique }) requires an existing inline .unique(...) declaration.',
      );
    }

    return new ScalarFieldBuilder({
      ...this.state,
      ...(spec.column ? { columnName: spec.column } : {}),
      ...(idSpec ? { id: { name: idSpec.name } } : {}),
      ...(uniqueSpec ? { unique: { name: uniqueSpec.name } } : {}),
    } as unknown as ApplyFieldSqlSpec<State, Spec>);
  }

  build(): State {
    return this.state;
  }
}

function columnField<Descriptor extends ColumnTypeDescriptor>(
  descriptor: Descriptor,
): ScalarFieldBuilder<ScalarFieldState<Descriptor['codecId'], undefined, false, undefined>> {
  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor,
    nullable: false,
  });
}

function generatedField<Descriptor extends ColumnTypeDescriptor>(
  spec: GeneratedFieldSpec & { readonly type: Descriptor },
): ScalarFieldBuilder<ScalarFieldState<Descriptor['codecId'], undefined, false, undefined>> {
  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor: {
      ...spec.type,
      ...(spec.typeParams ? { typeParams: spec.typeParams } : {}),
    },
    nullable: false,
    executionDefault: spec.generated,
  });
}

function namedTypeField<TypeRef extends string>(
  typeRef: TypeRef,
): ScalarFieldBuilder<ScalarFieldState<string, TypeRef, false, undefined>>;
function namedTypeField<TypeRef extends StorageTypeInstance>(
  typeRef: TypeRef,
): ScalarFieldBuilder<ScalarFieldState<TypeRef['codecId'], TypeRef, false, undefined>>;
function namedTypeField(
  typeRef: NamedStorageTypeRef,
): ScalarFieldBuilder<ScalarFieldState<string, NamedStorageTypeRef, false, undefined>> {
  return new ScalarFieldBuilder({
    kind: 'scalar',
    typeRef,
    nullable: false,
  });
}

export function buildFieldPreset(
  descriptor: AuthoringFieldPresetDescriptor,
  args: readonly unknown[],
  namedConstraintOptions?: NamedConstraintSpec,
): ScalarFieldBuilder {
  const preset = instantiateAuthoringFieldPreset(descriptor, args);

  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor: preset.descriptor,
    nullable: preset.nullable,
    ...ifDefined('default', preset.default as ColumnDefault | undefined),
    ...ifDefined(
      'executionDefault',
      preset.executionDefault as ExecutionMutationDefaultValue | undefined,
    ),
    ...(preset.id
      ? {
          id: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
        }
      : {}),
    ...(preset.unique
      ? {
          unique: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
        }
      : {}),
  });
}

type RelationModelRefSource = 'string' | 'token' | 'lazyToken';
type TargetFieldRefSource = 'string' | 'token';

type EagerRelationModelName<
  ModelName extends string = string,
  Source extends Exclude<RelationModelRefSource, 'lazyToken'> = Exclude<
    RelationModelRefSource,
    'lazyToken'
  >,
> = {
  readonly kind: 'relationModelName';
  readonly source: Source;
  readonly modelName: ModelName;
};

type LazyRelationModelName<ModelName extends string = string> = {
  readonly kind: 'lazyRelationModelName';
  readonly source: 'lazyToken';
  readonly resolve: () => ModelName;
};

type RelationModelSource<ModelName extends string = string> =
  | EagerRelationModelName<ModelName>
  | LazyRelationModelName<ModelName>;

type BelongsToRelation<
  ToModel extends string = string,
  FromField extends string | readonly string[] = string | readonly string[],
  ToField extends string | readonly string[] = string | readonly string[],
  SqlSpec extends BelongsToRelationSqlSpec | undefined = undefined,
> = {
  readonly kind: 'belongsTo';
  readonly toModel: RelationModelSource<ToModel>;
  readonly from: FromField;
  readonly to: ToField;
  readonly sql?: SqlSpec;
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
  | BelongsToRelation<
      string,
      string | readonly string[],
      string | readonly string[],
      BelongsToRelationSqlSpec | undefined
    >
  | HasManyRelation
  | HasOneRelation
  | ManyToManyRelation;

type AnyRelationState = RelationState;
type AnyRelationBuilder = RelationBuilder<AnyRelationState>;

type ApplyBelongsToRelationSqlSpec<
  State extends RelationState,
  SqlSpec extends BelongsToRelationSqlSpec,
> = State extends BelongsToRelation<
  infer ToModel,
  infer FromField,
  infer ToField,
  BelongsToRelationSqlSpec | undefined
>
  ? BelongsToRelation<ToModel, FromField, ToField, SqlSpec>
  : never;

export class RelationBuilder<State extends RelationState = AnyRelationState> {
  declare readonly __state: State;

  constructor(private readonly state: State) {}

  sql<const SqlSpec extends BelongsToRelationSqlSpec>(
    this: State extends BelongsToRelation<
      string,
      string | readonly string[],
      string | readonly string[],
      BelongsToRelationSqlSpec | undefined
    >
      ? RelationBuilder<State>
      : never,
    spec: SqlSpec,
  ): RelationBuilder<ApplyBelongsToRelationSqlSpec<State, SqlSpec>> {
    if (this.state.kind !== 'belongsTo') {
      throw new Error('relation.sql(...) is only supported for belongsTo relations.');
    }

    return new RelationBuilder({
      ...this.state,
      sql: spec,
    } as ApplyBelongsToRelationSqlSpec<State, SqlSpec>);
  }

  build(): State {
    return this.state;
  }
}

export type ColumnRef<FieldName extends string = string> = {
  readonly kind: 'columnRef';
  readonly fieldName: FieldName;
};

export type TargetFieldRef<
  ModelName extends string = string,
  FieldName extends string = string,
  Source extends TargetFieldRefSource = TargetFieldRefSource,
> = {
  readonly kind: 'targetFieldRef';
  readonly source: Source;
  readonly modelName: ModelName;
  readonly fieldName: FieldName;
};

export type ModelTokenRefs<
  ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
> = {
  readonly [K in keyof Fields]: TargetFieldRef<ModelName, K & string>;
};

type ConstraintOptions<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

type IndexOptions<Name extends string | undefined = string | undefined> =
  ConstraintOptions<Name> & {
    readonly using?: string;
    readonly config?: Record<string, unknown>;
  };

type ForeignKeyOptions<Name extends string | undefined = string | undefined> =
  ConstraintOptions<Name> & {
    readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly constraint?: boolean;
    readonly index?: boolean;
  };

type BelongsToRelationSqlSpec<Name extends string | undefined = string | undefined> = {
  readonly fk?: ForeignKeyOptions<Name>;
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

export type IndexConstraint<
  FieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = {
  readonly kind: 'index';
  readonly fields: FieldNames;
  readonly name?: Name;
  readonly using?: string;
  readonly config?: Record<string, unknown>;
};

export type ForeignKeyConstraint<
  SourceFieldNames extends readonly string[] = readonly string[],
  TargetModelName extends string = string,
  TargetFieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = {
  readonly kind: 'fk';
  readonly fields: SourceFieldNames;
  readonly targetModel: TargetModelName;
  readonly targetFields: TargetFieldNames;
  readonly targetSource?: TargetFieldRefSource;
  readonly name?: Name;
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
  readonly source: TargetFieldRefSource;
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
    source: refs.some((ref) => ref.source === 'string') ? 'string' : 'token',
  };
}

function createConstraintsDsl() {
  function ref<ModelName extends string, FieldName extends string>(
    modelName: ModelName,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName, FieldName> {
    return {
      kind: 'targetFieldRef',
      source: 'string',
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

  function index<FieldName extends string, Name extends string | undefined = undefined>(
    field: ColumnRef<FieldName>,
    options?: IndexOptions<Name>,
  ): IndexConstraint<readonly [FieldName], Name>;
  function index<FieldNames extends readonly string[], Name extends string | undefined = undefined>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: IndexOptions<Name>,
  ): IndexConstraint<FieldNames, Name>;
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
    Name extends string | undefined = undefined,
  >(
    field: ColumnRef<SourceFieldName>,
    target: TargetFieldRef<TargetModelName, TargetFieldName>,
    options?: ForeignKeyOptions<Name>,
  ): ForeignKeyConstraint<
    readonly [SourceFieldName],
    TargetModelName,
    readonly [TargetFieldName],
    Name
  >;
  function foreignKey<
    SourceFieldNames extends readonly string[],
    TargetModelName extends string,
    TargetFieldNames extends readonly string[],
    Name extends string | undefined = undefined,
  >(
    fields: { readonly [K in keyof SourceFieldNames]: ColumnRef<SourceFieldNames[K] & string> },
    target: {
      readonly [K in keyof TargetFieldNames]: TargetFieldRef<
        TargetModelName,
        TargetFieldNames[K] & string
      >;
    },
    options?: ForeignKeyOptions<Name>,
  ): ForeignKeyConstraint<SourceFieldNames, TargetModelName, TargetFieldNames, Name>;
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
      targetSource: normalizedTarget.source,
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
      source: 'token',
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

type StaticLiteralName<Name> = Name extends string ? (string extends Name ? never : Name) : never;

type NamedConstraintLiteralName<Constraint> = Constraint extends { readonly name?: infer Name }
  ? StaticLiteralName<Name>
  : never;

type DuplicateLiteralNames<
  Items extends readonly unknown[],
  Seen extends string = never,
  Duplicates extends string = never,
> = Items extends readonly [infer First, ...infer Rest extends readonly unknown[]]
  ? NamedConstraintLiteralName<First> extends infer Name extends string
    ? Name extends Seen
      ? DuplicateLiteralNames<Rest, Seen, Duplicates | Name>
      : DuplicateLiteralNames<Rest, Seen | Name, Duplicates>
    : DuplicateLiteralNames<Rest, Seen, Duplicates>
  : Duplicates;

type InlineIdLiteralName<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly [FieldName in keyof Fields]: FieldStateOf<Fields[FieldName]> extends {
    readonly id: { readonly name?: infer Name };
  }
    ? StaticLiteralName<Name>
    : never;
}[keyof Fields];

type AttributeIdLiteralName<AttributesSpec extends ModelAttributesSpec | undefined> =
  AttributesSpec extends {
    readonly id?: { readonly name?: infer Name };
  }
    ? StaticLiteralName<Name>
    : never;

type ModelIdLiteralName<
  Fields extends Record<string, ScalarFieldBuilder>,
  AttributesSpec extends ModelAttributesSpec | undefined,
> = [AttributeIdLiteralName<AttributesSpec>] extends [never]
  ? InlineIdLiteralName<Fields>
  : AttributeIdLiteralName<AttributesSpec>;

type SqlIndexes<SqlSpec extends SqlStageSpec> = SqlSpec extends {
  readonly indexes?: infer Indexes extends readonly unknown[];
}
  ? Indexes
  : readonly [];

type SqlForeignKeys<SqlSpec extends SqlStageSpec> = SqlSpec extends {
  readonly foreignKeys?: infer ForeignKeys extends readonly unknown[];
}
  ? ForeignKeys
  : readonly [];

type SqlNamedObjects<SqlSpec extends SqlStageSpec> = [
  ...SqlIndexes<SqlSpec>,
  ...SqlForeignKeys<SqlSpec>,
];

type ValidateSqlStageSpec<
  Fields extends Record<string, ScalarFieldBuilder>,
  AttributesSpec extends ModelAttributesSpec | undefined,
  SqlSpec extends SqlStageSpec,
> = [DuplicateLiteralNames<SqlNamedObjects<SqlSpec>>] extends [never]
  ? [
      Extract<
        ModelIdLiteralName<Fields, AttributesSpec>,
        NamedConstraintLiteralName<SqlNamedObjects<SqlSpec>[number]>
      >,
    ] extends [never]
    ? SqlSpec
    : never
  : never;

type ValidateAttributesStageSpec<
  Fields extends Record<string, ScalarFieldBuilder>,
  SqlSpec extends SqlStageSpec | undefined,
  AttributesSpec extends ModelAttributesSpec,
> = SqlSpec extends SqlStageSpec
  ? [
      Extract<
        ModelIdLiteralName<Fields, AttributesSpec>,
        NamedConstraintLiteralName<SqlNamedObjects<SqlSpec>[number]>
      >,
    ] extends [never]
    ? AttributesSpec
    : never
  : AttributesSpec;

function findDuplicateRelationName(
  existingRelations: Record<string, AnyRelationBuilder>,
  nextRelations: Record<string, AnyRelationBuilder>,
): string | undefined {
  return Object.keys(nextRelations).find((relationName) =>
    Object.hasOwn(existingRelations, relationName),
  );
}

export class ContractModelBuilder<
  ModelName extends string | undefined,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
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
      ? ContractModelBuilder<ModelName, Fields, Relations, AttributesSpec, SqlSpec>
      : never,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName & string, FieldName> {
    const modelName = this.stageOne.modelName;
    if (!modelName) {
      throw new Error('Model tokens require model("ModelName", ...) before calling .ref(...)');
    }

    return {
      kind: 'targetFieldRef',
      source: 'token',
      modelName,
      fieldName,
    } as TargetFieldRef<ModelName & string, FieldName>;
  }

  relations<const NextRelations extends Record<string, AnyRelationBuilder>>(
    relations: NextRelations,
  ): ContractModelBuilder<ModelName, Fields, Relations & NextRelations, AttributesSpec, SqlSpec> {
    const duplicateRelationName = findDuplicateRelationName(this.stageOne.relations, relations);
    if (duplicateRelationName) {
      throw new Error(
        `Model "${this.stageOne.modelName ?? '<anonymous>'}" already defines relation "${duplicateRelationName}".`,
      );
    }

    return new ContractModelBuilder(
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
    specOrFactory: StageInput<
      AttributeContext<Fields>,
      ValidateAttributesStageSpec<Fields, SqlSpec, NextAttributesSpec>
    >,
  ): ContractModelBuilder<ModelName, Fields, Relations, NextAttributesSpec, SqlSpec> {
    return new ContractModelBuilder(this.stageOne, specOrFactory, this.sqlFactory);
  }

  sql<const NextSqlSpec extends SqlStageSpec>(
    specOrFactory: StageInput<SqlContext<Fields>, NextSqlSpec>,
  ): [ValidateSqlStageSpec<Fields, AttributesSpec, NextSqlSpec>] extends [never]
    ? ContractModelBuilder<ModelName, Fields, Relations, AttributesSpec, never>
    : ContractModelBuilder<ModelName, Fields, Relations, AttributesSpec, NextSqlSpec> {
    // Conditional return type cannot be verified by the implementation; the
    // runtime value is always a valid ContractModelBuilder regardless of the
    // validation outcome (validation is type-level only).
    return new ContractModelBuilder(this.stageOne, this.attributesFactory, specOrFactory) as never;
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
): RelationModelSource<string>;
function normalizeRelationModelSource(
  target: string | AnyNamedModelToken | LazyNamedModelToken,
): RelationModelSource<string> {
  if (typeof target === 'string') {
    return {
      kind: 'relationModelName',
      source: 'string',
      modelName: target,
    };
  }

  if (typeof target === 'function') {
    return {
      kind: 'lazyRelationModelName',
      source: 'lazyToken',
      resolve: () => resolveNamedModelTokenName(target()),
    };
  }

  return {
    kind: 'relationModelName',
    source: 'token',
    modelName: resolveNamedModelTokenName(target),
  };
}

export type ContractInput<
  Family extends FamilyPackRef<string> = FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string> = TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  Models extends Record<
    string,
    ContractModelBuilder<
      string | undefined,
      Record<string, ScalarFieldBuilder>,
      Record<string, AnyRelationBuilder>,
      ModelAttributesSpec | undefined,
      SqlStageSpec | undefined
    >
  > = Record<never, never>,
  ExtensionPacks extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> = {
  readonly family: Family;
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
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
>(
  modelName: ModelName,
  input: {
    readonly fields: Fields;
    readonly relations?: Relations;
  },
): ContractModelBuilder<ModelName, Fields, Relations>;

export function model<
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
>(input: {
  readonly fields: Fields;
  readonly relations?: Relations;
}): ContractModelBuilder<undefined, Fields, Relations>;

export function model<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
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
): ContractModelBuilder<ModelName | undefined, Fields, Relations> {
  const input = typeof modelNameOrInput === 'string' ? maybeInput : modelNameOrInput;

  if (!input) {
    throw new Error('model("ModelName", ...) requires a model definition.');
  }

  return new ContractModelBuilder({
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
): RelationBuilder<BelongsToRelation<RelationModelName<Token>, FromField, ToField>>;
function belongsTo<
  ToModel extends string,
  FromField extends string | readonly string[],
  ToField extends string | readonly string[],
>(
  toModel: ToModel,
  options: { readonly from: FromField; readonly to: ToField },
): RelationBuilder<BelongsToRelation<ToModel, FromField, ToField>>;
function belongsTo(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): RelationBuilder<BelongsToRelation> {
  return new RelationBuilder({
    kind: 'belongsTo',
    toModel: normalizeRelationModelSource(toModel),
    from: options.from,
    to: options.to,
  });
}

function hasMany<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): RelationBuilder<HasManyRelation<RelationModelName<Token>, ByField>>;
function hasMany<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): RelationBuilder<HasManyRelation<ToModel, ByField>>;
function hasMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): RelationBuilder<HasManyRelation> {
  return new RelationBuilder({
    kind: 'hasMany',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  });
}

function hasOne<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): RelationBuilder<HasOneRelation<RelationModelName<Token>, ByField>>;
function hasOne<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): RelationBuilder<HasOneRelation<ToModel, ByField>>;
function hasOne(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): RelationBuilder<HasOneRelation> {
  return new RelationBuilder({
    kind: 'hasOne',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  });
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
): RelationBuilder<
  ManyToManyRelation<
    RelationModelName<ToToken>,
    RelationModelName<ThroughToken>,
    FromField,
    ToField
  >
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
): RelationBuilder<ManyToManyRelation<ToModel, ThroughModel, FromField, ToField>>;
function manyToMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly through: string | AnyNamedModelToken | LazyNamedModelToken;
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): RelationBuilder<ManyToManyRelation> {
  return new RelationBuilder({
    kind: 'manyToMany',
    toModel: normalizeRelationModelSource(toModel),
    through: normalizeRelationModelSource(options.through),
    from: options.from,
    to: options.to,
  });
}

export const rel = {
  belongsTo,
  hasMany,
  hasOne,
  manyToMany,
};

export const field = {
  column: columnField,
  generated: generatedField,
  namedType: namedTypeField,
};

export function isContractInput(value: unknown): value is ContractInput {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('family' in value)) {
    return false;
  }
  const target = (value as { target: unknown }).target;
  const family = (value as { family: unknown }).family;
  return (
    typeof target === 'object' &&
    target !== null &&
    'kind' in target &&
    target.kind === 'target' &&
    typeof family === 'object' &&
    family !== null &&
    'kind' in family &&
    family.kind === 'family'
  );
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
  return value.modelName;
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
export type RelationStateOf<T> = T extends RelationBuilder<infer State> ? State : never;

export type ModelFieldsOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    infer Fields,
    Record<string, AnyRelationBuilder>,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Fields
    : never;

export type ModelRelationsOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    infer Relations,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Relations
    : never;

export type ModelAttributesOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    infer AttributesSpec,
    SqlStageSpec | undefined
  >
    ? AttributesSpec
    : undefined;

export type ModelSqlOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, AnyRelationBuilder>,
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
