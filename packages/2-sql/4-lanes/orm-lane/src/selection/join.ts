import type { JoinOnExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef, createJoinOnExpr } from '../utils/ast.ts';

export function buildJoinOnExpr(
  parentTableName: string,
  parentColName: string,
  childTableName: string,
  childColName: string,
): JoinOnExpr {
  const leftCol = createColumnRef(parentTableName, parentColName);
  const rightCol = createColumnRef(childTableName, childColName);
  return createJoinOnExpr(leftCol, rightCol);
}
