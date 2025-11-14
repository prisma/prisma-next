import { planInvalid } from '@prisma-next/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyBinaryBuilder, AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { ModelColumnAccessor, OrmBuilderOptions, OrmRelationFilterBuilder } from './orm-types';

export class OrmRelationFilterBuilderImpl<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
> implements OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>
{
  private readonly context: QueryLaneContext<TContract>;
  private readonly contract: TContract;
  private readonly childModelName: ChildModelName;
  private wherePredicate: AnyBinaryBuilder | undefined = undefined;
  private modelAccessor: ModelColumnAccessor<TContract, CodecTypes, ChildModelName> | undefined =
    undefined;

  constructor(options: OrmBuilderOptions<TContract>, childModelName: ChildModelName) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.childModelName = childModelName;
    this.modelAccessor = this._getModelAccessor();
  }

  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => AnyBinaryBuilder,
  ): OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName> {
    const builder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, ChildModelName>(
      { context: this.context },
      this.childModelName,
    );
    builder.modelAccessor = this.modelAccessor;
    if (this.modelAccessor) {
      builder.wherePredicate = fn(this.modelAccessor);
    }
    return builder;
  }

  getWherePredicate(): AnyBinaryBuilder | undefined {
    return this.wherePredicate;
  }

  getChildModelName(): ChildModelName {
    return this.childModelName;
  }

  getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ChildModelName> {
    if (!this.modelAccessor) {
      this.modelAccessor = this._getModelAccessor();
    }
    if (!this.modelAccessor) {
      throw planInvalid(`Failed to get model accessor for ${this.childModelName}`);
    }
    return this.modelAccessor;
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ChildModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.childModelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.childModelName} not found in mappings`);
    }
    const schemaHandle = schema(this.context);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      throw planInvalid(`Table ${tableName} not found in schema`);
    }

    const accessor: Record<string, AnyColumnBuilder> = {};
    const model = this.contract.models[this.childModelName];
    if (!model || typeof model !== 'object' || !('fields' in model)) {
      throw planInvalid(`Model ${this.childModelName} does not have fields`);
    }
    const modelFields = model.fields as Record<string, { column?: string }>;

    for (const fieldName in modelFields) {
      const field = modelFields[fieldName];
      if (!field) continue;
      const columnName =
        this.contract.mappings.fieldToColumn?.[this.childModelName]?.[fieldName] ??
        field.column ??
        fieldName;
      const column = table.columns[columnName];
      if (column) {
        accessor[fieldName] = column as AnyColumnBuilder;
      }
    }

    return accessor as ModelColumnAccessor<TContract, CodecTypes, ChildModelName>;
  }
}
