import { Plan } from '@prisma/sql';
import { Schema } from '@prisma/relational-ir';
import { LintRule } from '../types';

export const noMissingLimit: LintRule = {
  id: 'no-missing-limit',
  check(plan: Plan): import('../types').RuleVerdict | null {
    if (plan.ast.type === 'select' && !plan.ast.where && !plan.ast.limit) {
      return {
        level: 'warn',
        code: 'no-missing-limit',
        message: 'Unbounded SELECT without WHERE or LIMIT may return too many rows.',
      };
    }
    return null;
  },
};
