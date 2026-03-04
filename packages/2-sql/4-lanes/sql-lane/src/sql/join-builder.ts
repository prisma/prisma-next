import type { JoinAst } from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createJoin,
  createJoinOnExpr,
  createTableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { JoinState } from '../utils/state';

export function buildJoinAst(join: JoinState): JoinAst {
  // TypeScript can't narrow ColumnBuilder properly, so we assert
  const onLeft = join.on.left as { table: string; column: string };
  const onRight = join.on.right as { table: string; column: string };
  const leftCol = createColumnRef(onLeft.table, onLeft.column);
  const rightCol = createColumnRef(onRight.table, onRight.column);
  const onExpr = createJoinOnExpr(leftCol, rightCol);
  return createJoin(join.joinType, createTableSource(join.table.name, join.table.alias), onExpr, false);
}
