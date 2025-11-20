import type {
  ColumnBuilderState,
  ForeignKeyConstraintState,
  IndexConstraintState,
  TableBuilderState,
  UniqueConstraintState,
} from './builder-state';

export class TableBuilder<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    never,
    ColumnBuilderState<string, boolean, string>
  >,
  PrimaryKey extends readonly string[] | undefined = undefined,
  Uniques extends ReadonlyArray<UniqueConstraintState> = ReadonlyArray<never>,
  Indexes extends ReadonlyArray<IndexConstraintState> = ReadonlyArray<never>,
  ForeignKeys extends ReadonlyArray<ForeignKeyConstraintState> = ReadonlyArray<never>,
> {
  private readonly _name: Name;
  private readonly _columns: Columns;
  private readonly _primaryKey: PrimaryKey;
  private readonly _uniques: Uniques;
  private readonly _indexes: Indexes;
  private readonly _foreignKeys: ForeignKeys;

  constructor(
    name: Name,
    columns: Columns = {} as Columns,
    primaryKey?: PrimaryKey,
    uniques: Uniques = [] as unknown as Uniques,
    indexes: Indexes = [] as unknown as Indexes,
    foreignKeys: ForeignKeys = [] as unknown as ForeignKeys,
  ) {
    this._name = name;
    this._columns = columns;
    this._primaryKey = primaryKey as PrimaryKey;
    this._uniques = uniques;
    this._indexes = indexes;
    this._foreignKeys = foreignKeys;
  }

  column<
    ColName extends string,
    TypeId extends string,
    Nullable extends boolean | undefined = undefined,
  >(
    name: ColName,
    options: {
      type: TypeId;
      nullable?: Nullable;
    },
  ): TableBuilder<
    Name,
    Columns &
      Record<ColName, ColumnBuilderState<ColName, Nullable extends true ? true : false, TypeId>>,
    PrimaryKey,
    Uniques,
    Indexes,
    ForeignKeys
  > {
    if (!options.type || typeof options.type !== 'string' || !options.type.includes('@')) {
      throw new Error(`type must be in format "namespace/name@version", got "${options.type}"`);
    }
    const nullable = (options.nullable ?? false) as Nullable extends true ? true : false;
    const type = options.type;
    const columnState = {
      name,
      nullable,
      type,
    } as ColumnBuilderState<ColName, Nullable extends true ? true : false, TypeId>;
    return new TableBuilder(
      this._name,
      { ...this._columns, [name]: columnState } as Columns &
        Record<ColName, ColumnBuilderState<ColName, Nullable extends true ? true : false, TypeId>>,
      this._primaryKey,
      this._uniques,
      this._indexes,
      this._foreignKeys,
    );
  }

  primaryKey<PK extends readonly string[]>(
    columns: PK,
    _name?: string,
  ): TableBuilder<Name, Columns, PK, Uniques, Indexes, ForeignKeys> {
    return new TableBuilder(
      this._name,
      this._columns,
      columns,
      this._uniques,
      this._indexes,
      this._foreignKeys,
    );
  }

  unique<Cols extends readonly string[]>(
    columns: Cols,
    name?: string,
  ): TableBuilder<
    Name,
    Columns,
    PrimaryKey,
    [...Uniques, { readonly columns: Cols; readonly name?: string }],
    Indexes,
    ForeignKeys
  > {
    const uniqueConstraint = {
      columns,
      ...(name !== undefined && { name }),
    } as const;
    return new TableBuilder(
      this._name,
      this._columns,
      this._primaryKey,
      [...this._uniques, uniqueConstraint] as [
        ...Uniques,
        { readonly columns: Cols; readonly name?: string },
      ],
      this._indexes,
      this._foreignKeys,
    );
  }

  index<Cols extends readonly string[]>(
    columns: Cols,
    name?: string,
  ): TableBuilder<
    Name,
    Columns,
    PrimaryKey,
    Uniques,
    [...Indexes, { readonly columns: Cols; readonly name?: string }],
    ForeignKeys
  > {
    const indexConstraint = {
      columns,
      ...(name !== undefined && { name }),
    } as const;
    return new TableBuilder(
      this._name,
      this._columns,
      this._primaryKey,
      this._uniques,
      [...this._indexes, indexConstraint] as [
        ...Indexes,
        { readonly columns: Cols; readonly name?: string },
      ],
      this._foreignKeys,
    );
  }

  foreignKey<Cols extends readonly string[]>(
    columns: Cols,
    references: { table: string; columns: readonly string[] },
    name?: string,
  ): TableBuilder<
    Name,
    Columns,
    PrimaryKey,
    Uniques,
    Indexes,
    [
      ...ForeignKeys,
      {
        readonly columns: Cols;
        readonly references: { readonly table: string; readonly columns: readonly string[] };
        readonly name?: string;
      },
    ]
  > {
    const foreignKeyConstraint = {
      columns,
      references,
      ...(name !== undefined && { name }),
    } as const;
    return new TableBuilder(
      this._name,
      this._columns,
      this._primaryKey,
      this._uniques,
      this._indexes,
      [...this._foreignKeys, foreignKeyConstraint] as [
        ...ForeignKeys,
        {
          readonly columns: Cols;
          readonly references: { readonly table: string; readonly columns: readonly string[] };
          readonly name?: string;
        },
      ],
    );
  }

  build(): TableBuilderState<Name, Columns, PrimaryKey, Uniques, Indexes, ForeignKeys> {
    return {
      name: this._name,
      columns: this._columns,
      ...(this._primaryKey !== undefined && { primaryKey: this._primaryKey }),
      ...(this._uniques.length > 0 && { uniques: this._uniques }),
      ...(this._indexes.length > 0 && { indexes: this._indexes }),
      ...(this._foreignKeys.length > 0 && { foreignKeys: this._foreignKeys }),
    } as TableBuilderState<Name, Columns, PrimaryKey, Uniques, Indexes, ForeignKeys>;
  }
}
