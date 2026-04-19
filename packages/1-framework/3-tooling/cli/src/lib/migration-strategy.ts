/**
 * Migration authoring strategy selector.
 *
 * Targets currently use one of two strategies to author `migration.ts`:
 *
 *  - **Descriptor flow** — the planner produces an `OperationDescriptor[]`
 *    and `migration.ts` is a `export default () => [...]` file that the CLI
 *    later replays through `resolveDescriptors` at emit time. Postgres uses
 *    this today.
 *  - **Class flow** — the planner produces a `MigrationPlanWithAuthoringSurface`
 *    that renders itself as a `class M extends Migration { ... }` file. The
 *    CLI dispatches to the target's `emit` capability at emit time. Mongo
 *    uses this today.
 *
 * The two are mutually exclusive at the target level: a migrations capability
 * either implements the descriptor-flow trio (`planWithDescriptors`,
 * `resolveDescriptors`, `renderDescriptorTypeScript`) or the class-flow
 * `emit` hook. `migrationStrategy` discriminates between them by observing
 * which hooks are present, and is consumed by `migration new`, `migration
 * plan`, and `migration emit` to keep strategy-specific branching in one
 * place.
 */

import { errorTargetHasIncompleteMigrationCapabilities } from '@prisma-next/errors/migration';
import type { TargetMigrationsCapability } from '@prisma-next/framework-components/control';

export type MigrationStrategy = 'descriptor' | 'class-based';

/**
 * Determine which authoring strategy a target uses, based on the shape of
 * its `TargetMigrationsCapability`. Callers that need strategy-specific
 * guarantees (e.g. that `resolveDescriptors` is present) should narrow on
 * the returned tag and trust the capability fields directly rather than
 * re-probing.
 *
 * Throws `errorTargetHasIncompleteMigrationCapabilities` (PN-MIG-2011) when
 * the capability registers neither flow. We diagnose this here rather than
 * deferring to the dispatch site so a misconfigured target gets an honest
 * "incomplete capability" error instead of being silently routed to one
 * flow and reported as missing the *other* flow's hook.
 */
export function migrationStrategy(
  migrations: TargetMigrationsCapability,
  targetId: string,
): MigrationStrategy {
  if (migrations.resolveDescriptors) return 'descriptor';
  if (migrations.emit) return 'class-based';
  throw errorTargetHasIncompleteMigrationCapabilities({ targetId });
}
