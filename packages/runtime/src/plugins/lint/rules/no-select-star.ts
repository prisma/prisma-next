import { Plan } from '@prisma/sql';
import { Schema } from '@prisma/relational-ir';
import { LintRule } from '../types';

export const noSelectStar: LintRule = {
  id: 'no-select-star',
  check(plan: Plan): import('../types').RuleVerdict | null {
    if (plan.ast.type === 'select' && plan.ast.projectStar) {
      return {
        level: 'error',
        code: 'no-select-star',
        message: 'SELECT * is disallowed. Explicitly list columns instead.',
      };
    }
    return null;
  },
};
