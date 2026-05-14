import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

export interface StorageTypeInstanceInput {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

/**
 * SQL Contract IR node for a named, parameterised type instance held in
 * `SqlStorage.types`. Lifted from the pre-R3 flat-data
 * `type StorageTypeInstance` to a class extending {@link SqlNode}
 * per FR18.
 *
 * Unlike {@link StorageColumn}, `typeParams` is required here because
 * `StorageTypeInstance` exists specifically to define reusable
 * parameterised types. A type instance without parameters would be
 * redundant — columns can reference the codec directly via `codecId`.
 */
export class StorageTypeInstance extends SqlNode {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;

  constructor(input: StorageTypeInstanceInput) {
    super();
    this.codecId = input.codecId;
    this.nativeType = input.nativeType;
    this.typeParams = input.typeParams;
    freezeNode(this);
  }
}
