import type { ColumnDefault } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

/**
 * Hydration / construction input shape for {@link StorageColumn}. Mirrors
 * the on-disk storage JSON envelope exactly so the family-base
 * serializer's hydration walker can hand an arktype-validated literal
 * straight to `new`.
 *
 * `typeParams` and `typeRef` remain mutually exclusive (one or the
 * other, not both); the constructor preserves whichever caller-side
 * choice the input encodes.
 */
export interface StorageColumnInput {
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
  readonly default?: ColumnDefault;
}

/**
 * SQL Contract IR node for a single column entry in `StorageTable.columns`.
 * Lifted from the pre-R3 flat-data `interface StorageColumn` to a class
 * extending {@link SqlNode} per FR18.
 *
 * Single concrete family-layer class (no target subclass) per the
 * Decision 14 family-shared-shape rule. The class type accepts any
 * caller that constructs via `new StorageColumn(input)`; literal
 * construction sites must pass through the constructor or the SPI
 * hydration walker.
 *
 * The column's `name` is not on the class — columns are keyed by name
 * in the parent `StorageTable.columns: Record<string, StorageColumn>`
 * map, so a `name` field would be redundant with the key.
 */
export class StorageColumn extends SqlNode {
  readonly nativeType: string;
  readonly codecId: string;
  readonly nullable: boolean;
  declare readonly typeParams?: Record<string, unknown>;
  declare readonly typeRef?: string;
  declare readonly default?: ColumnDefault;

  constructor(input: StorageColumnInput) {
    super();
    this.nativeType = input.nativeType;
    this.codecId = input.codecId;
    this.nullable = input.nullable;
    if (input.typeParams !== undefined) this.typeParams = input.typeParams;
    if (input.typeRef !== undefined) this.typeRef = input.typeRef;
    if (input.default !== undefined) this.default = input.default;
    freezeNode(this);
  }
}
