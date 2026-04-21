import { type ImportRequirement, MigrationTsExpression } from './migration-ts-expression';

/**
 * A planner-generated stub for a `dataTransform` `check` or `run` body.
 *
 * When a planner can't decide the exact query body at plan time (e.g. a
 * user-filled backfill), it emits a `PlaceholderExpression(slot)`. The
 * rendered `migration.ts` gets `() => placeholder("slot")` at the right
 * spot, and `renderOps` produces a runtime op whose `check` / `run`
 * closures throw `PN-MIG-2001` on invocation. This is the basis for
 * Option B: migrations with placeholders can render their TypeScript source
 * but cannot materialize their runtime operations until the author fills
 * in every slot.
 *
 * Package-private. Always an immediate child of a `DataTransformCall` — it
 * is not a member of the `PostgresOpFactoryCall` union.
 */
export class PlaceholderExpression extends MigrationTsExpression {
  readonly slot: string;

  constructor(slot: string) {
    super();
    this.slot = slot;
    Object.freeze(this);
  }

  renderTypeScript(): string {
    return `() => placeholder(${JSON.stringify(this.slot)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' }];
  }
}
