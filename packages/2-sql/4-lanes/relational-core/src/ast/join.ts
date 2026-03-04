import { planInvalid } from '@prisma-next/plan';
import type { AnyColumnBuilder, JoinOnBuilder, JoinOnPredicate } from '../types';
import { isColumnBuilder } from '../types';
import type { ColumnRef, FromSource, JoinAst, JoinOnExpr } from './types';

export function createJoin(
  joinType: 'inner' | 'left' | 'right' | 'full',
  source: FromSource,
  on: JoinOnExpr,
  lateral = false,
): JoinAst {
  return {
    kind: 'join',
    joinType,
    source,
    lateral,
    on,
  };
}

export function createJoinOnExpr(left: ColumnRef, right: ColumnRef): JoinOnExpr {
  return {
    kind: 'eqCol',
    left,
    right,
  };
}

class JoinOnBuilderImpl implements JoinOnBuilder {
  eqCol(left: AnyColumnBuilder, right: AnyColumnBuilder): JoinOnPredicate {
    if (!left || !isColumnBuilder(left)) {
      throw planInvalid('Join ON left operand must be a column');
    }

    if (!right || !isColumnBuilder(right)) {
      throw planInvalid('Join ON right operand must be a column');
    }

    // TypeScript can't narrow ColumnBuilder properly, so we assert
    const leftCol = left as unknown as { table: string; column: string };
    const rightCol = right as unknown as { table: string; column: string };
    if (leftCol.table === rightCol.table) {
      throw planInvalid('Self-joins are not supported in MVP');
    }

    return {
      kind: 'join-on',
      left: left as AnyColumnBuilder,
      right: right as AnyColumnBuilder,
    };
  }
}

export function createJoinOnBuilder(): JoinOnBuilder {
  return new JoinOnBuilderImpl();
}
