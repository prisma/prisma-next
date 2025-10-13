import { Plan } from '@prisma/sql';
import { Schema } from '@prisma/relational-ir';
import { LintRule } from '../types';

export const noUnindexedColumnInWhere: LintRule = {
  id: 'no-unindexed-column-in-where',
  check(plan: Plan, ir: Schema): import('../types').RuleVerdict | null {
    if (plan.ast.type !== 'select' || !plan.ast.where) return null;

    // Extract column from WHERE predicate (simple eq check)
    const condition = plan.ast.where.condition;
    if (condition.kind === 'eq' && condition.left.kind === 'column') {
      const tableName = plan.ast.from;
      const columnName = condition.left.name;
      const table = ir.tables[tableName];
      const column = table?.columns[columnName];

      if (column && !column.pk && !column.unique) {
        return {
          level: 'warn',
          code: 'no-unindexed-column-in-where',
          message: `WHERE clause uses non-indexed column '${columnName}' which may cause performance issues.`,
        };
      }
    }
    return null;
  },
};
