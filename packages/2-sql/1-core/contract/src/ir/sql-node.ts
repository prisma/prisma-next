import { SchemaNodeBase } from '@prisma-next/framework-components/ir';

/**
 * SQL family IR node base. Carries the family-level `kind` discriminator
 * default (`'sql'`) and inherits the framework's `freezeNode` affordance.
 *
 * Single family-level discriminator (not per-leaf) reflects the fact that
 * SQL IR has no polymorphic dispatch today — verifiers and serializers
 * walk by structural position (`storage.tables[name].columns[name]`),
 * not by inspecting `kind`. The abstract bar for per-leaf discriminators
 * isn't earned until a future polymorphic consumer arrives.
 *
 * Future per-leaf overrides land cleanly: a class that gains a
 * polymorphic-dispatch consumer (e.g. `SqlEnumType` once an enum kind is
 * walked alongside other types) overrides `kind` with its narrower
 * literal — `override readonly kind = 'sql-enum-type' as const` — without
 * a base-class refactor.
 */
export abstract class SqlNode extends SchemaNodeBase {
  readonly kind?: string = 'sql';
}
