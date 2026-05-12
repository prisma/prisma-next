/**
 * Framework-level IR alphabet.
 *
 * The framework's contribution to Contract IR / Schema IR is the bare
 * promise that every node has a string-typed `kind` discriminant. Family
 * abstract bases (e.g. `SqlNode`, `MongoSchemaNode`) refine the alphabet for
 * their family shape; targets ship the concrete classes.
 *
 * `SchemaNodeBase` is a convenience: it centralises the freeze-and-assign
 * pattern used by every concrete IR node in the codebase (proven on
 * `OpFactoryCall` and `MongoSchemaNode`). Subclasses call `this.freeze()`
 * in their constructors after assigning their fields. The base class itself
 * stays minimal — no kind discriminant, no methods on instances — so it can
 * sit at the framework layer without committing to any family-shaped vocabulary.
 *
 * Frozen instances + plain readonly fields keep IR nodes JSON-clean by
 * construction, so `JSON.stringify(node)` produces canonical JSON without a
 * `toJSON()` method. The `ContractSerializer` SPI handles round-trip from
 * canonical JSON back to typed class instances.
 */

export interface SchemaNode {
  readonly kind: string;
}

export abstract class SchemaNodeBase implements SchemaNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}
