import type {
  ColumnBuilderState,
  ColumnDefaultDef,
  ColumnTypeDescriptor,
  ForeignKeyDef,
  IndexDef,
  TableBuilderState,
  UniqueConstraintDef,
} from './builder-state';

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

  column<
    ColName extends string,
    Descriptor extends ColumnTypeDescriptor,
    Nullable extends boolean | undefined = undefined,
  >(
    name: ColName,
    options: {
      type: Descriptor;
      nullable?: Nullable;
      typeParams?: Record<string, unknown>;
      default?: ColumnDefaultDef;
    },
  ): TableBuilder<
    Name,
    Columns &
      Record<
        ColName,
        ColumnBuilderState<ColName, Nullable extends true ? true : false, Descriptor['codecId']>
      >,
    PrimaryKey
  > {
    const nullable = (options.nullable ?? false) as Nullable extends true ? true : false;
    const { codecId, nativeType, typeParams: descriptorTypeParams } = options.type;
    const typeParams = options.typeParams ?? descriptorTypeParams;

    const columnState = {
      name,
      nullable,
      type: codecId,
      nativeType,
      ...(typeParams ? { typeParams } : {}),
      ...(options.default ? { default: options.default } : {}),
    } as ColumnBuilderState<ColName, Nullable extends true ? true : false, Descriptor['codecId']>;
    const newColumns = { ...this._columns, [name]: columnState } as Columns &
      Record<
        ColName,
        ColumnBuilderState<ColName, Nullable extends true ? true : false, Descriptor['codecId']>
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
    name?: string,
  ): TableBuilder<Name, Columns, PrimaryKey> {
    const fkDef: ForeignKeyDef = name ? { columns, references, name } : { columns, references };
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
