/**
 * Programmatic init, imported as `@prisma-next/cli/init`: `planInit`
 * stages the full scaffold in memory under the CLI's non-interactive
 * contract; `applyInitPlan` writes it.
 */

export type { PackageManager } from '../commands/init/detect-package-manager';
export {
  applyInitPlan,
  type InitApplyResult,
  type InitPlan,
  type InitPlanOptions,
  type PlannedInitFile,
  planInit,
} from '../commands/init/plan';
