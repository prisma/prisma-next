/**
 * User-facing `dataTransform` factory for the SQLite migration authoring
 * surface. Invoked directly inside a `migration.ts` file to supply a
 * user-authored SQL statement that runs with operation class `'data'`.
 *
 * Typical use: the planner emits a `DataTransformCall` stub when a NOT NULL
 * tightening requires a backfill. The rendered `migration.ts` exposes the
 * backfill as a `placeholder("…")` slot the user fills in with an
 * `UPDATE … WHERE col IS NULL` statement. The filled-in `dataTransform(...)`
 * invocation returns a runnable operation the runner executes before the
 * subsequent recreate-table op copies data into the tightened schema.
 */

import { buildTargetDetails } from '../planner-target-details';
import { type Op, step } from './shared';

export interface DataTransformOptions {
  /** Stable id used in the ledger / for runner idempotency tracking. */
  readonly id: string;
  /** Human-readable label surfaced in CLI output. */
  readonly label: string;
  /** Table the backfill targets; informs `target.details`. */
  readonly table: string;
  /**
   * Short description of the step (shown by the runner on execute). The
   * planner leaves this as `placeholder(...)` for users to replace.
   */
  readonly description: string;
  /**
   * Lazy producer of the SQL string to execute. Lazy so planner-emitted
   * stubs can embed `() => placeholder(...)` without throwing at
   * module-load time — only when the op is enumerated for execution.
   */
  readonly run: () => string;
}

export function dataTransform(opts: DataTransformOptions): Op {
  return {
    id: opts.id,
    label: opts.label,
    summary: opts.description,
    operationClass: 'data',
    target: { id: 'sqlite', details: buildTargetDetails('table', opts.table) },
    precheck: [],
    execute: [step(opts.description, opts.run())],
    postcheck: [],
  };
}
