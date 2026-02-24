import type { MockRuntime } from '../helpers';

export function normalizeSql(sqlText: string): string {
  return sqlText.replace(/\s+/g, ' ').trim();
}

export function serializePlans(runtime: MockRuntime) {
  return runtime.executions.map(({ plan }) => ({
    lane: plan.meta.lane,
    sql: normalizeSql(plan.sql),
    params: plan.params,
  }));
}
