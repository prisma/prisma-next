/**
 * Planner-produced Postgres migration.
 *
 * Returned by the walk-schema planner (`PostgresMigrationPlanner.plan(...)`
 * and `emptyMigration(...)` once retargeted). Holds the class-flow IR
 * (`PostgresOpFactoryCall[]`) alongside `MigrationMeta` and exposes both
 * the runtime-ops view (`get operations`) and the TypeScript authoring view
 * (`renderTypeScript()`). Satisfies `MigrationPlanWithAuthoringSurface` so
 * the CLI can uniformly serialize any planner result back to `migration.ts`.
 *
 * Extends the family-level `SqlMigration` alias rather than the target-local
 * class-flow base directly — mirrors Mongo's `PlannerProducedMongoMigration`
 * shape and keeps Phase 3 CLI wiring one step removed from target internals.
 *
 * Behavior with placeholder-bearing plans: `renderTypeScript()` always
 * succeeds and embeds `() => placeholder("slot")` at each stub; `operations`
 * walks `renderOps`, which for Phase 1 does not emit data transforms (the
 * walk-schema planner does not produce them), so placeholder-bearing plans
 * from this planner are impossible today. Phase 2 lowers placeholders into
 * runtime ops whose closures throw `PN-MIG-2001` on invocation.
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

  constructor(
    private readonly calls: readonly PostgresOpFactoryCall[],
    private readonly meta: MigrationMeta,
  ) {
    super();
  }

  override get operations(): readonly Op[] {
    return renderOps(this.calls);
  }

  override describe(): MigrationMeta {
    return this.meta;
  }

  renderTypeScript(): string {
    return renderCallsToTypeScript(this.calls, {
      from: this.meta.from,
      to: this.meta.to,
      ...ifDefined('kind', this.meta.kind),
      ...ifDefined('labels', this.meta.labels),
    });
  }
}
