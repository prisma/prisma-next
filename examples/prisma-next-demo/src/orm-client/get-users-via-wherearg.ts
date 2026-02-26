import type { ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

function filterByKind(kind: 'admin' | 'user'): ToWhereExpr {
  return {
    toWhereExpr() {
      return {
        expr: {
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'user', column: 'kind' },
          right: { kind: 'param', index: 1 },
        },
        params: [kind],
        paramDescriptors: [{ source: 'lane' }],
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
