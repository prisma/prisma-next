import { type ImportRequirement, TsExpression } from '@prisma-next/ts-render';

/**
 * A planner-generated stub for a `dataTransform` `check` or `run` body.
 *
 * Renders as the bare expression `placeholder("slot")`. The call-site
 * (`DataTransformCall`) wraps it with `() =>` to form the closure body.
 *
 * Package-private. Always an immediate child of a `DataTransformCall` — it
 * is not a member of the `PostgresOpFactoryCall` union.
 */
export class PlaceholderExpression extends TsExpression {
  readonly slot: string;

  constructor(slot: string) {
    super();
    this.slot = slot;
    Object.freeze(this);
  }

  renderTypeScript(): string {
    return `placeholder(${JSON.stringify(this.slot)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@prisma-next/errors/migration', symbol: 'placeholder' }];
  }
}
