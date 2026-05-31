import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import type { MarkerStatement } from '@prisma-next/sql-relational-core/ast';

export { APP_SPACE_ID };

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface WriteMarkerInput {
  /**
   * Logical space identifier for this marker row. Required at every
   * call site so the type system surfaces every place that needs to
   * thread the value (rather than letting an `?? APP_SPACE_ID`
   * fall-through silently collapse multi-space markers onto the
   * `'app'` row). App-plan callers pass {@link APP_SPACE_ID}
   * (`'app'`); per-extension callers pass the extension's space id.
   */
  readonly space: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson?: unknown;
  readonly canonicalVersion?: number;
  readonly appTag?: string;
  readonly meta?: Record<string, unknown>;
  /**
   * Applied-invariants set on the marker.
   *
   * - `undefined` → existing column left untouched. Sign and
   *   verify-database paths use this; they don't accumulate invariants.
   * - explicit value (including `[]`) → column overwritten with
   *   exactly that value.
   */
  readonly invariants?: readonly string[];
}

export function readContractMarker(space: string): MarkerStatement {
  return {
    sql: `select
      core_hash,
      profile_hash,
      contract_json,
      canonical_version,
      updated_at,
      app_tag,
      meta,
      invariants
    from prisma_contract.marker
    where space = $1`,
    params: [space],
  };
}

export interface WriteContractMarkerStatements {
  readonly insert: SqlStatement;
  readonly update: SqlStatement;
}

/**
 * Variable columns that participate in INSERT/UPDATE alongside the
 * always-on `space = $1` and `updated_at = now()`. Each column declares
 * its name, optional cast type, and parameter value; the placeholder
 * (`$N`) is computed positionally below — adding or reordering a
 * column doesn't desync indices. `invariants` only appears when the
 * caller supplies it — see `WriteMarkerInput.invariants`.
 */
function markerColumns(
  input: WriteMarkerInput,
): ReadonlyArray<{ readonly name: string; readonly type?: string; readonly param: unknown }> {
  return [
    { name: 'core_hash', param: input.storageHash },
    { name: 'profile_hash', param: input.profileHash },
    { name: 'contract_json', type: 'jsonb', param: input.contractJson ?? null },
    { name: 'canonical_version', param: input.canonicalVersion ?? null },
    { name: 'app_tag', param: input.appTag ?? null },
    { name: 'meta', type: 'jsonb', param: JSON.stringify(input.meta ?? {}) },
    ...(input.invariants !== undefined
      ? [{ name: 'invariants' as const, type: 'text[]' as const, param: input.invariants }]
      : []),
  ];
}

export function writeContractMarker(input: WriteMarkerInput): WriteContractMarkerStatements {
  const cols = markerColumns(input);
  // $1 is reserved for `space`; subsequent positions follow the order of cols.
  const placed = cols.map((c, i) => ({
    name: c.name,
    expr: c.type ? `$${i + 2}::${c.type}` : `$${i + 2}`,
    param: c.param,
  }));
  const params: readonly unknown[] = [input.space, ...placed.map((c) => c.param)];

  // `updated_at = now()` is a SQL literal with no parameter slot, so it
  // sits outside `placed` and is appended directly to each statement.
  const insertColumns = ['space', ...placed.map((c) => c.name), 'updated_at'].join(', ');
  const insertValues = ['$1', ...placed.map((c) => c.expr), 'now()'].join(', ');
  const setClauses = [...placed.map((c) => `${c.name} = ${c.expr}`), 'updated_at = now()'].join(
    ', ',
  );

  return {
    insert: {
      sql: `insert into prisma_contract.marker (${insertColumns}) values (${insertValues})`,
      params,
    },
    update: {
      sql: `update prisma_contract.marker set ${setClauses} where space = $1`,
      params,
    },
  };
}
