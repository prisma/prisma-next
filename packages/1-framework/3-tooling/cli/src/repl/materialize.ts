/**
 * Turns evaluated values into results worth printing. The REPL's core
 * ergonomic: a submitted query builder, plan, or ORM collection executes
 * immediately — no `.build()`, no `execute()`, no `await` required.
 */

export interface MaterializedResult {
  readonly value: unknown;
  /** True when the REPL ran a query to produce the value. */
  readonly executed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value['then'] === 'function';
}

function isQueryPlan(value: unknown): boolean {
  return isRecord(value) && 'ast' in value && 'meta' in value && 'params' in value;
}

function isBuilder(value: unknown): value is { build(): unknown } {
  return isRecord(value) && typeof value['build'] === 'function' && !isQueryPlan(value);
}

function isOrmCollection(value: unknown): value is { all(): unknown } {
  return (
    isRecord(value) && typeof value['all'] === 'function' && typeof value['where'] === 'function'
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
