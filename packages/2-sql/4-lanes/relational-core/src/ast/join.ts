import { planInvalid } from '@prisma-next/plan';
import type { AnyColumnBuilder, JoinOnBuilder, JoinOnPredicate } from '../types';
import { isColumnBuilder } from '../types';
import { EqColJoinOn, JoinAst } from './types';

class JoinOnBuilderImpl implements JoinOnBuilder {
  eqCol(left: AnyColumnBuilder, right: AnyColumnBuilder): JoinOnPredicate {
    if (!left || !isColumnBuilder(left)) {
      throw planInvalid('Join ON left operand must be a column');
    }

    if (!right || !isColumnBuilder(right)) {
      throw planInvalid('Join ON right operand must be a column');
    }

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

export { EqColJoinOn, JoinAst };

export function createJoinOnBuilder(): JoinOnBuilder {
  return new JoinOnBuilderImpl();
}
