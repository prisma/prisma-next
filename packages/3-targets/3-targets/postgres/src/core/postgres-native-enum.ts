import type { ControlPolicy } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';

export interface PostgresNativeEnumMember {
  readonly name: string;
  readonly value: string;
}

export interface PostgresNativeEnumInput {
  /** The Postgres type name (`CREATE TYPE <typeName> AS ENUM (…)`). */
  readonly typeName: string;
  /** Members in declaration order — this is the Postgres enum sort order. */
  readonly members: readonly PostgresNativeEnumMember[];
  readonly control?: ControlPolicy;
}

/**
 * Postgres contract-IR class for a native enum type (`CREATE TYPE … AS ENUM (…)`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree will use `PostgresNativeEnumSchemaNode` when the managed phase
 * builds it.
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly,
 * frozen at construction via `freezeNode(this)`. The `kind: 'postgres-enum'`
 * discriminant is enumerable so it survives JSON. Lives at
 * `storage.namespaces[ns].entries.native_enum[HandleName]`; the entries key
 * (`native_enum`) is the entity-kind descriptor's `kind`, decoupled from this
 * node's own `kind` literal — the same shape as `table`/`StorageTable` and
 * `valueSet`/`StorageValueSet`.
 */
export class PostgresNativeEnum extends SqlNode {
  static is(node: unknown): node is PostgresNativeEnum {
    return (
      typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'postgres-enum'
    );
  }

  override readonly kind = 'postgres-enum' as const;
  readonly typeName: string;
  readonly members: readonly PostgresNativeEnumMember[];
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresNativeEnumInput) {
    super();
    this.typeName = input.typeName;
    this.members = Object.freeze(input.members.map((m) => ({ name: m.name, value: m.value })));
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}
