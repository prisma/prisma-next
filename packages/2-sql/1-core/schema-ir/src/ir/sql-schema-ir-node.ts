import { IRNodeBase } from '@prisma-next/framework-components/ir';

/**
 * SQL Schema IR node base. Carries the family-level
 * `kind = 'sql-schema-ir'` discriminator and inherits the framework's
 * `freezeNode` affordance.
 *
 * SQL Schema IR represents the actual database state as discovered by
 * introspection (the parallel to SQL Contract IR, which represents the
 * desired state). Like the Contract side, today's Schema IR has no
 * polymorphic dispatch — verifiers and planners walk by structural
 * position, not by inspecting `kind` — so a single family-level
 * discriminator is sufficient. Future per-leaf overrides land cleanly
 * the same way as on the Contract side.
 *
 * The discriminator is installed as a non-enumerable own property,
 * matching the SqlNode pattern. This keeps `JSON.stringify(node)`
 * canonical (no `kind` field), keeps `toEqual({...})` test assertions
 * against pre-lift flat shapes passing, and keeps `node.kind` readable
 * for future polymorphic dispatch.
 */
export abstract class SqlSchemaIRNode extends IRNodeBase {
  readonly kind?: string;

  /**
   * Enumerable discriminant identifying which node this is (database /
   * namespace / table / policy / role). Target concretions set a unique value;
   * the `.is`/`.assert`/`.ensure` guards compare against it. Unlike `kind`, it
   * is enumerable, so it survives the `projectSchemaToSpace` spread that
   * flattens the tree into plain objects.
   */
  readonly nodeKind?: string;

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
