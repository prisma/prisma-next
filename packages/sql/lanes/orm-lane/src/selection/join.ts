import { createColumnRef, createJoinOnExpr } from '../utils/ast';

export function buildJoinOnExpr(
  parentTableName: string,
  parentColName: string,
  childTableName: string,
  childColName: string,
): import('@prisma-next/sql-target').JoinOnExpr {
  const leftCol = createColumnRef(parentTableName, parentColName);
  const rightCol = createColumnRef(childTableName, childColName);
  return createJoinOnExpr(leftCol, rightCol);
}
