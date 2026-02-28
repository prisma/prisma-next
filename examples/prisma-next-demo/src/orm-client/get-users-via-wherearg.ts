import type { ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { Runtime } from '@prisma-next/sql-runtime';
import { kysely } from '../prisma/db';
import { createOrmClient } from './client';

function filterByKind(kind: 'admin' | 'user'): ToWhereExpr {
  return {
    toWhereExpr() {
      const filterQuery = kysely.selectFrom('user').select('id').where('kind', '=', kind).limit(1);
      const filterPlan = kysely.build(filterQuery);
      if (filterPlan.ast.kind !== 'select' || !filterPlan.ast.where) {
        throw new Error('Expected a select plan with a where clause');
      }
      return {
        expr: filterPlan.ast.where,
        params: filterPlan.params,
        paramDescriptors: filterPlan.meta.paramDescriptors,
      };
    },
  };
}

export async function ormClientGetUsersViaWhereArg(
  kind: 'admin' | 'user',
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.users
    .where(() => filterByKind(kind))
    .take(limit)
    .all();
}
