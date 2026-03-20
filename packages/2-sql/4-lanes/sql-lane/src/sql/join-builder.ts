import { ColumnRef, EqColJoinOn, JoinAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { JoinState } from '../utils/state';

export function buildJoinAst(join: JoinState): JoinAst {
  // TypeScript can't narrow ColumnBuilder properly, so we assert
  const onLeft = join.on.left as { table: string; column: string };
  const onRight = join.on.right as { table: string; column: string };
  const onExpr = EqColJoinOn.of(
    ColumnRef.of(onLeft.table, onLeft.column),
    ColumnRef.of(onRight.table, onRight.column),
  );
  const tableSource = TableSource.named(join.table.name, join.table.alias);

  switch (join.joinType) {
    case 'inner':
      return JoinAst.inner(tableSource, onExpr);
    case 'left':
      return JoinAst.left(tableSource, onExpr);
    case 'right':
      return JoinAst.right(tableSource, onExpr);
    case 'full':
      return JoinAst.full(tableSource, onExpr);
    default: {
      const exhaustiveCheck: never = join.joinType;
      throw new Error(`Unsupported join type: ${String(exhaustiveCheck)}`);
    }
  }
}
