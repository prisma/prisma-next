import { Plan } from '@prisma/sql';
import { Schema } from '@prisma/relational-ir';
import { LintRule } from '../types';

export const mutationRequiresWhere: LintRule = {
  id: 'mutation-requires-where',
  check(plan: Plan): import('../types').RuleVerdict | null {
    // Note: This rule is currently disabled as QueryAST only supports SELECT queries
    // In the future, when UPDATE/DELETE are added to QueryAST, this rule can be enabled
    return null;
  },
};
