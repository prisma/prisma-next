import type { ControlPolicy } from '@prisma-next/contract/types';
import type { DiffableNode } from '@prisma-next/framework-components/control';
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
 * Postgres IR class for a native enum type (`CREATE TYPE … AS ENUM (…)`).
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly,
 * frozen at construction via `freezeNode(this)`. The `kind: 'postgres-enum'`
 * discriminant is enumerable so it survives JSON. Lives at
 * `storage.namespaces[ns].entries.native_enum[HandleName]`; the entries key
 * (`native_enum`) is the entity-kind descriptor's `kind`, decoupled from this
 * node's own `kind` literal — the same shape as `table`/`StorageTable` and
 * `valueSet`/`StorageValueSet`.
 *
 * `DiffableNode` is implemented for future migration-phase reuse (the RLS
 * `PostgresRole`/`PostgresRlsPolicy` template); it is not wired into any
 * differ in the MVP — external enums are never diffed.
 */
export class PostgresNativeEnum extends SqlNode implements DiffableNode {
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

  /** Native enum types are schema-unique; the type name alone is sufficient as the id. */
  get id(): string {
    return this.typeName;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    if (!PostgresNativeEnum.is(other)) {
      throw new Error(
        `PostgresNativeEnum.isEqualTo: expected a PostgresNativeEnum, got ${other.constructor?.name ?? typeof other}`,
      );
    }
    if (this.typeName !== other.typeName) return false;
    if (this.members.length !== other.members.length) return false;
    return this.members.every(
      (m, i) => m.name === other.members[i]?.name && m.value === other.members[i]?.value,
    );
  }
}
