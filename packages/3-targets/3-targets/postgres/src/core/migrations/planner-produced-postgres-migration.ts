/**
 * Planner-produced Postgres migration.
 *
 * Returned by `PostgresMigrationPlanner.plan(...)` and `emptyMigration(...)`.
 * Holds the class-flow IR (`PostgresOpFactoryCall[]`) alongside
 * `MigrationMeta` and exposes both the runtime-ops view (`get operations`)
 * and the TypeScript authoring view (`renderTypeScript()`). Satisfies
 * `MigrationPlanWithAuthoringSurface` so the CLI can uniformly serialize any
 * planner result back to `migration.ts`.
 *
 * Extends the family-level `SqlMigration` alias rather than the target-local
 * class-flow base directly — mirrors Mongo's `PlannerProducedMongoMigration`
 * shape and keeps CLI wiring one step removed from target internals.
 *
 * Placeholder-bearing plans: `renderTypeScript()` always succeeds and embeds
 * `() => placeholder("slot")` at each stub. `operations` dispatches each
 * call's `toOp()`; `DataTransformCall.toOp()` throws `PN-MIG-2001` because a
 * planner-stubbed closure cannot be lowered to a runtime op. In practice the
 * walk-schema planner does not emit `DataTransformCall`s today, so this
 * throw is reserved for future issue-planner integrations that author data
 * transforms and require a user edit before execution.
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { Migration as SqlMigration } from '@prisma-next/family-sql/migration';
import type { MigrationPlanWithAuthoringSurface } from '@prisma-next/framework-components/control';
import type { MigrationMeta } from '@prisma-next/migration-tools/migration';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresOpFactoryCall } from './op-factory-call';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { renderOps } from './render-ops';
import { renderCallsToTypeScript } from './render-typescript';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

export class TypeScriptRenderablePostgresMigration
  extends SqlMigration<PostgresPlanTargetDetails>
  implements MigrationPlanWithAuthoringSurface
{
  readonly targetId = 'postgres' as const;

  readonly #calls: readonly PostgresOpFactoryCall[];
  readonly #meta: MigrationMeta;

  constructor(calls: readonly PostgresOpFactoryCall[], meta: MigrationMeta) {
    super();
    this.#calls = calls;
    this.#meta = meta;
  }

  override get operations(): readonly Op[] {
    return renderOps(this.#calls);
  }

  override describe(): MigrationMeta {
    return this.#meta;
  }

  renderTypeScript(): string {
    return renderCallsToTypeScript(this.#calls, {
      from: this.#meta.from,
      to: this.#meta.to,
      ...ifDefined('kind', this.#meta.kind),
      ...ifDefined('labels', this.#meta.labels),
    });
  }
}
