import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import { schema } from './schema';
import type {
  BinaryBuilder,
  ColumnBuilder,
} from './types';
import type { ModelColumnAccessor, OrmBuilderOptions, OrmRelationFilterBuilder } from './orm-types';

export class OrmRelationFilterBuilderImpl<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
> implements OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName>
{
  private readonly contract: TContract;
  private readonly codecTypes: CodecTypes;
  private readonly childModelName: ChildModelName;
  private wherePredicate: BinaryBuilder | undefined = undefined;
  private readonly adapter: OrmBuilderOptions<TContract, CodecTypes>['adapter'];
  private modelAccessor: ModelColumnAccessor<TContract, CodecTypes, ChildModelName> | undefined = undefined;

  constructor(
    options: OrmBuilderOptions<TContract, CodecTypes>,
    childModelName: ChildModelName,
  ) {
    this.contract = options.contract;
    this.adapter = options.adapter;
    this.codecTypes = (options.codecTypes ?? {}) as CodecTypes;
    this.childModelName = childModelName;
    this.modelAccessor = this._getModelAccessor();
  }

  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => BinaryBuilder,
  ): OrmRelationFilterBuilder<TContract, CodecTypes, ChildModelName> {
    const builder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, ChildModelName>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.childModelName,
    );
    builder.modelAccessor = this.modelAccessor;
    builder.wherePredicate = fn(this.modelAccessor);
    return builder;
  }

  getWherePredicate(): BinaryBuilder | undefined {
    return this.wherePredicate;
  }

  getChildModelName(): ChildModelName {
    return this.childModelName;
  }

  getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ChildModelName> {
    if (!this.modelAccessor) {
      this.modelAccessor = this._getModelAccessor();
    }
    return this.modelAccessor;
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ChildModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.childModelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.childModelName} not found in mappings`);
    }
    const schemaHandle = schema(this.contract, this.codecTypes);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      throw planInvalid(`Table ${tableName} not found in schema`);
    }

    const accessor = {} as ModelColumnAccessor<TContract, CodecTypes, ChildModelName>;
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
        (accessor as Record<string, ColumnBuilder>)[fieldName] = column;
      }
    }

    return accessor;
  }
}

