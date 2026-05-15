import type { IRNode } from './ir-node';

/**
 * Framework-level alphabet for entries in a storage `types` slot.
 *
 * The slot is polymorphic at the framework level: a family or target can
 * persist either a JSON-clean codec-triple object literal (carrying
 * `kind: 'codec-instance'`) or a class-instance IR node with a narrower
 * kind discriminator (e.g. `'postgres-enum'`). Hydration walkers,
 * verifiers, and planners dispatch on the `kind` literal to recover the
 * precise variant.
 *
 * The `kind` field is required at this layer (in contrast with
 * `IRNode.kind` which is optional) because the slot's downstream
 * consumers dispatch on it — without a guaranteed discriminator the
 * polymorphic walk cannot pick the right reader.
 *
 * The shape declares only `kind` so any structural sub-interface
 * (`StorageTypeInstance` and target-specific IR class subtypes) is
 * assignable. Concrete variants narrow `kind` to their literal and add
 * their own fields.
 */
export interface StorageType extends IRNode {
  readonly kind: string;
}
