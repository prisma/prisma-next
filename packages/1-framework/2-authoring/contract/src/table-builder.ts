import type {
  ColumnBuilderState,
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

export class TableBuilder<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    never,
    ColumnBuilderState<string, boolean, string>
  >,
  PrimaryKey extends readonly string[] | undefined = undefined,
> {
  private readonly _state: TableBuilderInternalState<Name, Columns, PrimaryKey>;

  constructor(
    name: Name,
    columns: Columns = {} as Columns,
    primaryKey?: PrimaryKey,
    primaryKeyName?: string,
    uniques: readonly UniqueConstraintDef[] = [],
    indexes: readonly IndexDef[] = [],
    foreignKeys: readonly ForeignKeyDef[] = [],
  ) {
    this._state = {
      name,
      columns,
      primaryKey: primaryKey as PrimaryKey,
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
    const { codecId, nativeType } = options.type;

    const columnState = {
      name,
      nullable,
      type: codecId,
      nativeType,
    } as ColumnBuilderState<ColName, Nullable extends true ? true : false, Descriptor['codecId']>;
    return new TableBuilder(
      this._name,
      { ...this._columns, [name]: columnState } as Columns &
        Record<
          ColName,
          ColumnBuilderState<ColName, Nullable extends true ? true : false, Descriptor['codecId']>
        >,
      this._primaryKey,
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
      this._name,
      this._columns,
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
      this._name,
      this._columns,
      this._primaryKey,
      this._state.primaryKeyName,
      [...this._state.uniques, constraint],
      this._state.indexes,
      this._state.foreignKeys,
    );
  }

  index(columns: readonly string[], name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    const indexDef: IndexDef = name ? { columns, name } : { columns };
    return new TableBuilder(
      this._name,
      this._columns,
      this._primaryKey,
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
      this._name,
      this._columns,
      this._primaryKey,
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
