import type { JoinAst } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createJoin,
  createJoinOnExpr,
  createTableRef,
} from '@prisma-next/sql-relational-core/ast';
import type { JoinState } from '../utils/state';

export function buildJoinAst(join: JoinState): JoinAst {
  // TypeScript can't narrow ColumnBuilder properly, so we assert
  const onLeft = join.on.left as { table: string; column: string };
  const onRight = join.on.right as { table: string; column: string };
  const leftCol = createColumnRef(onLeft.table, onLeft.column);
  const rightCol = createColumnRef(onRight.table, onRight.column);
  const onExpr = createJoinOnExpr(leftCol, rightCol);
  return createJoin(join.joinType, createTableRef(join.table.name), onExpr);
}
