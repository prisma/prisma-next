import type { ModelBuilderState, RelationDefinition } from './builder-state';

export class ModelBuilder<
  Name extends string,
  Table extends string,
  Fields extends Record<string, string> = Record<never, never>,
  Relations extends Record<string, RelationDefinition> = Record<never, never>,
> {
  private readonly _name: Name;
  private readonly _table: Table;
  private readonly _fields: Fields;
  private readonly _relations: Relations;

  constructor(
    name: Name,
    table: Table,
    fields: Fields = {} as Fields,
    relations: Relations = {} as Relations,
  ) {
    this._name = name;
    this._table = table;
    this._fields = fields;
    this._relations = relations;
  }

  field<FieldName extends string, ColumnName extends string>(
    fieldName: FieldName,
    columnName: ColumnName,
  ): ModelBuilder<Name, Table, Fields & Record<FieldName, ColumnName>, Relations> {
    return new ModelBuilder(
      this._name,
      this._table,
      {
        ...this._fields,
        [fieldName]: columnName,
      } as Fields & Record<FieldName, ColumnName>,
      this._relations,
    );
  }

  relation<RelationName extends string, ToModel extends string, ToTable extends string>(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: '1:1' | '1:N' | 'N:1';
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: ToTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>>;
  relation<
    RelationName extends string,
    ToModel extends string,
    ToTable extends string,
    JunctionTable extends string,
  >(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: 'N:M';
      through: {
        table: JunctionTable;
        parentColumns: readonly string[];
        childColumns: readonly string[];
      };
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: JunctionTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>>;
  relation<
    RelationName extends string,
    ToModel extends string,
    ToTable extends string,
    JunctionTable extends string = never,
  >(
    name: RelationName,
    options: {
      toModel: ToModel;
      toTable: ToTable;
      cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
      through?: {
        table: JunctionTable;
        parentColumns: readonly string[];
        childColumns: readonly string[];
      };
      on: {
        parentTable: Table;
        parentColumns: readonly string[];
        childTable: ToTable | JunctionTable;
        childColumns: readonly string[];
      };
    },
  ): ModelBuilder<Name, Table, Fields, Relations & Record<RelationName, RelationDefinition>> {
    // Validate parentTable matches model's table
    if (options.on.parentTable !== this._table) {
      throw new Error(
        `Relation "${name}" parentTable "${options.on.parentTable}" does not match model table "${this._table}"`,
      );
    }

    // Validate childTable matches toTable (for non-N:M) or through.table (for N:M)
    if (options.cardinality === 'N:M') {
      if (!options.through) {
        throw new Error(`Relation "${name}" with cardinality "N:M" requires through field`);
      }
      if (options.on.childTable !== options.through.table) {
        throw new Error(
          `Relation "${name}" childTable "${options.on.childTable}" does not match through.table "${options.through.table}"`,
        );
      }
    } else {
      if (options.on.childTable !== options.toTable) {
        throw new Error(
          `Relation "${name}" childTable "${options.on.childTable}" does not match toTable "${options.toTable}"`,
        );
      }
    }

    const relationDef: RelationDefinition = {
      to: options.toModel,
      cardinality: options.cardinality,
      on: {
        parentCols: options.on.parentColumns,
        childCols: options.on.childColumns,
      },
      ...(options.through
        ? {
            through: {
              table: options.through.table,
              parentCols: options.through.parentColumns,
              childCols: options.through.childColumns,
            },
          }
        : undefined),
    };

    return new ModelBuilder(this._name, this._table, this._fields, {
      ...this._relations,
      [name]: relationDef,
    } as Relations & Record<RelationName, RelationDefinition>);
  }

  build(): ModelBuilderState<Name, Table, Fields, Relations> {
    return {
      name: this._name,
      table: this._table,
      fields: this._fields,
      relations: this._relations,
    };
  }
}
