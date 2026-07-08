import { IRNodeBase } from '@prisma-next/framework-components/ir';
import { relationalNodeRole, type SqlSchemaDiffRole } from './schema-node-kinds';

export type { SqlSchemaDiffRole } from './schema-node-kinds';

/**
 * SQL Schema IR node base. Carries the family-level
 * `kind = 'sql-schema-ir'` discriminator and inherits the framework's
 * `freezeNode` affordance.
 *
 * SQL Schema IR represents the actual database state as discovered by
 * introspection (the parallel to SQL Contract IR, which represents the
 * desired state).
 *
 * The discriminator is installed as a non-enumerable own property,
 * matching the SqlNode pattern. This keeps `JSON.stringify(node)`
 * canonical (no `kind` field), keeps `toEqual({...})` test assertions
 * against pre-lift flat shapes passing, and keeps `node.kind` readable
 * for dispatch.
 *
 * Both `kind` and `nodeKind` are required: every concrete leaf is a node
 * the generic differ can pair and compare, so every leaf must declare which
 * node it is. `nodeKind` has no default here — every direct subclass sets its
 * own literal value (the relational leaves via `RelationalSchemaNodeKind`,
 * target concretions via their own vocabulary, e.g. `PostgresSchemaNodeKind`).
 */
export abstract class SqlSchemaIRNode extends IRNodeBase {
  declare readonly kind: string;

  /**
   * Enumerable discriminant identifying which node this is (column / primary
   * key / foreign key / unique / index / check / database / namespace /
   * table / policy / role / …). Concretions set a unique value; the
   * `.is`/`.assert` guards compare against it. Unlike `kind`, it is
   * enumerable, so it survives a spread that flattens a node into a plain
   * object.
   */
  abstract readonly nodeKind: string;

  /**
   * {@link SqlSchemaDiffRole}, resolved from `nodeKind` via the one real map
   * in `relationalNodeRole` — verdict logic dispatches on this, never on the
   * `nodeKind` spelling and never via a hand-written per-class return.
   * Implemented as a getter so it stays off the instance (invisible to
   * spreads, `Object.keys`, and JSON), unlike `nodeKind`. Target-specific
   * concretions whose `nodeKind` is outside the relational vocabulary (e.g.
   * Postgres's namespace/table/policy/role) override this with their own
   * map lookup.
   */
  get diffRole(): SqlSchemaDiffRole {
    return relationalNodeRole(this.nodeKind);
  }

  constructor() {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'sql-schema-ir',
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}

/**
 * Defines a non-enumerable own property, the same treatment `kind` gets
 * above: a derivation-time render-support field stays out of
 * `JSON.stringify`, `toEqual({...})` structural assertions, and spreads,
 * while remaining directly readable (`node.field`) for the one consumer
 * that resolves it at plan time. A no-op when `value` is `undefined` — the
 * property is simply absent, matching every other optional field on these
 * nodes.
 */
export function defineNonEnumerable<T extends object>(
  target: T,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}
