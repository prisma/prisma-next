/**
 * Framework-level IR alphabet.
 *
 * The framework's contribution to Contract IR / Schema IR is the bare
 * promise that every node has a string-typed `kind` discriminant. Family
 * abstract bases (e.g. `SqlNode`, `MongoSchemaNode`) refine the alphabet for
 * their family shape; targets ship the concrete classes.
 *
 * `SchemaNodeBase` is a minimal abstract base that pins the `kind`
 * requirement at the class layer so the IR class hierarchy has a single
 * root. It carries no methods: the freeze-and-assign affordance lives in
 * the free `freezeNode` helper below. Keeping `freezeNode` out of the class
 * type means an emitted contract literal type (`{ readonly kind: 'mongo-
 * collection', ... }`) is structurally assignable to its class type — a
 * `protected freeze()` instance method would otherwise leak into the public
 * type surface and require the literal to carry it too (see
 * `wip/unattended-decisions.md § 8`).
 *
 * Subclasses construct fields then call `freezeNode(this)` to seal the
 * instance. Frozen instances + plain readonly fields keep IR nodes
 * JSON-clean by construction, so `JSON.stringify(node)` produces canonical
 * JSON without a `toJSON()` method. The `ContractSerializer` SPI handles
 * round-trip from canonical JSON back to typed class instances.
 */

export interface SchemaNode {
  readonly kind: string;
}

export abstract class SchemaNodeBase implements SchemaNode {
  abstract readonly kind: string;
}

/**
 * Seal an IR class instance after its constructor has assigned all
 * fields. The free-helper form (rather than a `protected freeze()`
 * instance method) keeps the class type structurally narrow so emitted
 * contract literal types remain assignable to their class types.
 */
export function freezeNode<T extends SchemaNode>(node: T): T {
  Object.freeze(node);
  return node;
}
