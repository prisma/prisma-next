import type { ColumnDefault, ExecutionMutationDefaultValue } from '@prisma-next/contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  ColumnBuilderState,
  ColumnTypeDescriptor,
  ForeignKeyDef,
  IndexDef,
  NullableColumnCannotHaveDefault,
  ReferentialAction,
  TableBuilderState,
  UniqueConstraintDef,
} from './builder-state';

/**
 * Column options for nullable columns.
 * Nullable columns cannot have a default value.
 */
interface NullableColumnOptions<Descriptor extends ColumnTypeDescriptor> {
  type: Descriptor;
  nullable: true;
  typeParams?: Record<string, unknown>;
  default?: NullableColumnCannotHaveDefault;
}

/**
 * Column options for non-nullable columns.
 * Non-nullable columns can optionally have a default value.
 */
interface NonNullableColumnOptions<Descriptor extends ColumnTypeDescriptor> {
  type: Descriptor;
  nullable?: false;
  typeParams?: Record<string, unknown>;
  default?: ColumnDefault;
}

type GeneratedColumnOptions<Descriptor extends ColumnTypeDescriptor> = Omit<
  NonNullableColumnOptions<Descriptor>,
  'default' | 'nullable'
> & {
  /**
   * Generated columns are always non-nullable and use mutation-time defaults
   * that the runtime injects when the column is omitted from insert input.
   */
  nullable?: false;
  generated: ExecutionMutationDefaultValue;
};

/**
 * Column options that enforce nullable/default mutual exclusivity.
 *
 * Invariant: A column with a default value is always NOT NULL.
 * - If `nullable: true`, the `default` property is forbidden
 * - If `nullable` is `false` or omitted, the `default` property is allowed
 */
type ColumnOptions<Descriptor extends ColumnTypeDescriptor> =
  | NullableColumnOptions<Descriptor>
  | NonNullableColumnOptions<Descriptor>;

type NullableFromOptions<TOptions> = TOptions extends { nullable: true } ? true : false;

interface TableBuilderInternalState<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>>,
  PrimaryKey extends readonly string[] | undefined,
> {
  readonly name: Name;
  readonly columns: Columns;
  readonly primaryKey: PrimaryKey;
  readonly primaryKeyName: string | undefined;
  readonly uniques: readonly UniqueConstraintDef[];
  readonly indexes: readonly IndexDef[];
  readonly foreignKeys: readonly ForeignKeyDef[];
}

/**
 * Creates a new table builder with the given name.
 * This is the preferred way to create a TableBuilder - it ensures
 * type parameters are inferred correctly without unsafe casts.
 */
export function createTable<Name extends string>(name: Name): TableBuilder<Name> {
  return new TableBuilder(name, {}, undefined, undefined, [], [], []);
}

/**
 * Builder for defining table structure with type-safe chaining.
 * Use `createTable(name)` to create instances.
 */
export class TableBuilder<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    never,
    ColumnBuilderState<string, boolean, string>
  >,
  PrimaryKey extends readonly string[] | undefined = undefined,
> {
  private readonly _state: TableBuilderInternalState<Name, Columns, PrimaryKey>;

  /** @internal Use createTable() instead */
  constructor(
    name: Name,
    columns: Columns,
    primaryKey: PrimaryKey,
    primaryKeyName: string | undefined,
    uniques: readonly UniqueConstraintDef[],
    indexes: readonly IndexDef[],
    foreignKeys: readonly ForeignKeyDef[],
  ) {
    this._state = {
      name,
      columns,
      primaryKey,
      primaryKeyName,
      uniques,
      indexes,
      foreignKeys,
    };
  }

  private get _name(): Name {
    return this._state.name;
  }

  private get _columns(): Columns {
    return this._state.columns;
  }

  private get _primaryKey(): PrimaryKey {
    return this._state.primaryKey;
  }

  /**
   * Add a nullable column to the table.
   * Nullable columns cannot have a default value.
   */
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: NullableColumnOptions<Descriptor>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, true, Descriptor['codecId']>>,
    PrimaryKey
  >;

  /**
   * Add a non-nullable column to the table.
   * Non-nullable columns can optionally have a default value.
   */
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: NonNullableColumnOptions<Descriptor>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, false, Descriptor['codecId']>>,
    PrimaryKey
  >;

  /**
   * Implementation of the column method.
   */
  column<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: ColumnOptions<Descriptor>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, boolean, Descriptor['codecId']>>,
    PrimaryKey
  > {
    return this.columnInternal(name, options);
  }

  generated<ColName extends string, Descriptor extends ColumnTypeDescriptor>(
    name: ColName,
    options: GeneratedColumnOptions<Descriptor>,
  ): TableBuilder<
    Name,
    Columns & Record<ColName, ColumnBuilderState<ColName, false, Descriptor['codecId']>>,
    PrimaryKey
  > {
    const { generated, ...columnOptions } = options;
    return this.columnInternal(name, columnOptions, generated);
  }

  private columnInternal<
    ColName extends string,
    Descriptor extends ColumnTypeDescriptor,
    Options extends ColumnOptions<Descriptor>,
  >(
    name: ColName,
    options: Options,
    executionDefault?: ExecutionMutationDefaultValue,
  ): TableBuilder<
    Name,
    Columns &
      Record<
        ColName,
        ColumnBuilderState<ColName, NullableFromOptions<Options>, Descriptor['codecId']>
      >,
    PrimaryKey
  > {
    const nullable = options.nullable ?? false;
    const { codecId, nativeType, typeParams: descriptorTypeParams, typeRef } = options.type;
    const typeParams = options.typeParams ?? descriptorTypeParams;

    // The type safety is enforced at the call site via overloads:
    // - NullableColumnOptions forbids `default` when `nullable: true`
    // - NonNullableColumnOptions allows `default` when `nullable` is false/omitted
    const columnState = {
      name,
      nullable,
      type: codecId,
      nativeType,
      ...ifDefined('typeParams', typeParams),
      ...ifDefined('typeRef', typeRef),
      ...ifDefined('default', 'default' in options ? options.default : undefined),
      ...ifDefined('executionDefault', executionDefault),
    } as ColumnBuilderState<ColName, NullableFromOptions<Options>, Descriptor['codecId']>;
    const newColumns = { ...this._columns, [name]: columnState } as Columns &
      Record<
        ColName,
        ColumnBuilderState<ColName, NullableFromOptions<Options>, Descriptor['codecId']>
      >;
    return new TableBuilder(
      this._state.name,
      newColumns,
      this._state.primaryKey,
      this._state.primaryKeyName,
      this._state.uniques,
      this._state.indexes,
      this._state.foreignKeys,
    );
  }

  primaryKey<PK extends readonly string[]>(
    columns: PK,
    name?: string,
  ): TableBuilder<Name, Columns, PK> {
    return new TableBuilder(
      this._state.name,
      this._state.columns,
      columns,
      name,
      this._state.uniques,
      this._state.indexes,
      this._state.foreignKeys,
    );
  }

  unique(columns: readonly string[], name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    const constraint: UniqueConstraintDef = name ? { columns, name } : { columns };
    return new TableBuilder(
      this._state.name,
      this._state.columns,
      this._state.primaryKey,
      this._state.primaryKeyName,
      [...this._state.uniques, constraint],
      this._state.indexes,
      this._state.foreignKeys,
    );
  }

  index(columns: readonly string[], name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    const indexDef: IndexDef = name ? { columns, name } : { columns };
    return new TableBuilder(
      this._state.name,
      this._state.columns,
      this._state.primaryKey,
      this._state.primaryKeyName,
      this._state.uniques,
      [...this._state.indexes, indexDef],
      this._state.foreignKeys,
    );
  }

  foreignKey(
    columns: readonly string[],
    references: { table: string; columns: readonly string[] },
    nameOrOptions?:
      | string
      | {
          name?: string;
          onDelete?: ReferentialAction;
          onUpdate?: ReferentialAction;
        },
  ): TableBuilder<Name, Columns, PrimaryKey> {
    let fkDef: ForeignKeyDef;
    if (typeof nameOrOptions === 'string') {
      fkDef = { columns, references, name: nameOrOptions };
    } else if (nameOrOptions) {
      fkDef = {
        columns,
        references,
        ...(nameOrOptions.name !== undefined && { name: nameOrOptions.name }),
        ...(nameOrOptions.onDelete !== undefined && { onDelete: nameOrOptions.onDelete }),
        ...(nameOrOptions.onUpdate !== undefined && { onUpdate: nameOrOptions.onUpdate }),
      };
    } else {
      fkDef = { columns, references };
    }
    return new TableBuilder(
      this._state.name,
      this._state.columns,
      this._state.primaryKey,
      this._state.primaryKeyName,
      this._state.uniques,
      this._state.indexes,
      [...this._state.foreignKeys, fkDef],
    );
  }

  build(): TableBuilderState<Name, Columns, PrimaryKey> {
    return {
      name: this._name,
      columns: this._columns,
      ...(this._primaryKey !== undefined ? { primaryKey: this._primaryKey } : {}),
      ...(this._state.primaryKeyName !== undefined
        ? { primaryKeyName: this._state.primaryKeyName }
        : {}),
      uniques: this._state.uniques,
      indexes: this._state.indexes,
      foreignKeys: this._state.foreignKeys,
    } as TableBuilderState<Name, Columns, PrimaryKey>;
  }
}
