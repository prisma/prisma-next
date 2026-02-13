import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from './collection';
import type { DefaultModelRow, RepositoryContext } from './types';
import { emptyState } from './types';

export class Repository<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends keyof TContract['models'] & string,
> extends Collection<TContract, ModelName, DefaultModelRow<TContract, ModelName>> {
  constructor(ctx: RepositoryContext<TContract>, modelName: ModelName) {
    const mappings = ctx.contract.mappings;
    const tableName = mappings.modelToTable?.[modelName] ?? modelName.toLowerCase();
    super(ctx, modelName, tableName, emptyState());
  }
}
