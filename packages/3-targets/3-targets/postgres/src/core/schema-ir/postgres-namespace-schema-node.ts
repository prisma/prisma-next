import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import {
  type SqlAnnotations,
  SqlSchemaIRNode,
  type SqlSchemaTarget,
} from '@prisma-next/sql-schema-ir/types';
import type { PostgresTableSchemaNode } from './postgres-table-schema-node';

export interface PostgresNamespaceSchemaNodeInput {
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnumTypeNames: readonly string[];
}

/**
 * One-per-Postgres-schema diff-tree node. Groups the tables belonging to a
 * single namespace and satisfies the `SqlSchemaIR` shape so legacy per-schema
 * consumers (verifySqlSchema, the relational planner, toSchemaView) can
 * accept it unchanged in Unit 6.
 *
 * `id` is the schema name. `isEqualTo` is always true — namespace-level
 * attribute diffing is not needed yet. `children()` returns the table nodes.
 *
 * The `annotations.pg` bag mirrors what `PostgresSchemaIR` carried for the
 * per-schema slot (`schema` + `nativeEnumTypeNames`). `existingSchemas` is
 * database-level and belongs on `PostgresDatabaseSchemaNode`, not here.
 * The bag is carried only for legacy compatibility and will be retired with
 * the annotations bag (TML-2936).
 */
export class PostgresNamespaceSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  readonly nodeTarget: SqlSchemaTarget = 'postgres';
  readonly schemaName: string;
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  declare readonly annotations?: SqlAnnotations;
  readonly nativeEnumTypeNames: readonly string[];

  constructor(input: PostgresNamespaceSchemaNodeInput) {
    super();
    this.schemaName = input.schemaName;
    this.tables = input.tables;
    this.nativeEnumTypeNames = Object.freeze([...input.nativeEnumTypeNames]);
    this.annotations = {
      pg: {
        schema: input.schemaName,
        ...(input.nativeEnumTypeNames.length > 0 && {
          nativeEnumTypeNames: input.nativeEnumTypeNames,
        }),
      },
    };
    freezeNode(this);
  }

  get id(): string {
    return this.schemaName;
  }

  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return Object.values(this.tables);
  }

  static is(node: DiffableNode): node is PostgresNamespaceSchemaNode {
    return node instanceof PostgresNamespaceSchemaNode;
  }
}
