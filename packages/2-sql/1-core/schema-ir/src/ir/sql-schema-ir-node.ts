import { IRNodeBase } from '@prisma-next/framework-components/ir';

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
