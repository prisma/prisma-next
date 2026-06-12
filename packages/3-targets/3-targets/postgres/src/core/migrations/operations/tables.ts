import { qualifyTableName, toRegclassLiteral } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

/**
 * Legacy raw-string copy: this sync, lowerer-less factory still inlines its
 * to_regclass checks as SQL literals. The typed, parameterized form lives in
 * `tableExistsAst` (src/contract-free/checks.ts) and is used by
 * `CreateTableCall.toOp(lowerer)`. Converting this factory (and its
 * authored-migration facade export) is deferred to D3 of the
 * typed-migration-verification-queries slice.
 */
export function dropTable(schemaName: string, tableName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      ),
    ],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${qualified}`)],
    postcheck: [
      step(
        `verify table "${tableName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      ),
    ],
  };
}
