import type { ColumnBuilderState, TableBuilderState } from './builder-state';

export class TableBuilder<
  Name extends string,
  Columns extends Record<string, ColumnBuilderState<string, boolean, string>> = Record<
    never,
    ColumnBuilderState<string, boolean, string>
  >,
  PrimaryKey extends readonly string[] | undefined = undefined,
> {
  private readonly _name: Name;
  private readonly _columns: Columns;
  private readonly _primaryKey: PrimaryKey;

  constructor(name: Name, columns: Columns = {} as Columns, primaryKey?: PrimaryKey) {
    this._name = name;
    this._columns = columns;
    this._primaryKey = primaryKey as PrimaryKey;
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
    PrimaryKey
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
    );
  }

  primaryKey<PK extends readonly string[]>(
    columns: PK,
    _name?: string,
  ): TableBuilder<Name, Columns, PK> {
    return new TableBuilder(this._name, this._columns, columns);
  }

  unique(_columns: readonly string[], _name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  index(_columns: readonly string[], _name?: string): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  foreignKey(
    _columns: readonly string[],
    _references: { table: string; columns: readonly string[] },
    _name?: string,
  ): TableBuilder<Name, Columns, PrimaryKey> {
    return this;
  }

  build(): TableBuilderState<Name, Columns, PrimaryKey> {
    return {
      name: this._name,
      columns: this._columns,
      ...(this._primaryKey !== undefined ? { primaryKey: this._primaryKey } : {}),
    } as TableBuilderState<Name, Columns, PrimaryKey>;
  }
}
