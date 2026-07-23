/**
 * Turns evaluated values into results worth printing. The REPL's core
 * ergonomic: a submitted query builder, plan, or ORM collection executes
 * immediately — no `.build()`, no `execute()`, no `await` required.
 *
 * Detection is structural but deliberately multi-signal: a lone `build`
 * method or a plan-shaped POJO the user only wanted to inspect must not be
 * executed against the live database, so each guard requires several
 * markers of the real lane objects.
 */
import { isThenable } from '@prisma-next/utils/promise';

export interface MaterializedResult {
  readonly value: unknown;
  /** True when the REPL ran a query to produce the value. */
  readonly executed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** SQL query plans carry ast + params + meta with a lane tag (see SqlQueryPlan). */
function isQueryPlan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const meta = value['meta'];
  return (
    isRecord(value['ast']) &&
    Array.isArray(value['params']) &&
    isRecord(meta) &&
    typeof meta['lane'] === 'string'
  );
}

/** SQL lane builders expose build() alongside chainable query methods. */
function isBuilder(value: unknown): value is { build(): unknown } {
  return (
    isRecord(value) &&
    typeof value['build'] === 'function' &&
    (typeof value['where'] === 'function' ||
      typeof value['orderBy'] === 'function' ||
      typeof value['returning'] === 'function') &&
    !isQueryPlan(value)
  );
}

/** ORM collections expose the read-chain trio all/where/include. */
function isOrmCollection(value: unknown): value is { all(): unknown } {
  return (
    isRecord(value) &&
    typeof value['all'] === 'function' &&
    typeof value['where'] === 'function' &&
    typeof value['include'] === 'function'
  );
}

export async function materializeResult(
  value: unknown,
  executePlan: (plan: unknown) => Promise<unknown>,
): Promise<MaterializedResult> {
  let current: unknown = value;
  let executed = false;

  if (isThenable(current)) {
    current = await current;
  }

  if (isBuilder(current)) {
    current = current.build();
  }

  if (isQueryPlan(current)) {
    current = await executePlan(current);
    executed = true;
  } else if (isOrmCollection(current)) {
    current = await current.all();
    executed = true;
  }

  return { value: current, executed };
}
