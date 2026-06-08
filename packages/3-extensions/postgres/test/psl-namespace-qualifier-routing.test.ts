import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import {
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '@prisma-next/target-postgres/types';
import { describe, expect, it } from 'vitest';

const postgresTargetPackRef: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const postgresScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
] as const);

/**
 * End-to-end demonstration that the FR15 slice-3 + FR16a wiring lines
 * up: a PSL document goes through the SQL PSL interpreter; the
 * Postgres `createNamespace` factory threads target-specific
 * `Namespace` concretions into `SqlStorage.namespaces`; and looking up
 * a model's `namespaceId` in that map yields the right qualifier
 * behaviour for DDL emission (`PostgresUnboundSchema` elides;
 * `PostgresSchema(id)` qualifies).
 *
 * Renders the namespace abstraction the planned AC6 PGlite integration
 * test relies on. The planner-side rewire (replacing
 * `qualifyTableName(ctx.schemaName, X)` with
 * `namespace.qualifyTable(X)` across ~28 DDL/check call sites in
 * `core/migrations/`) is the natural slice for a follow-on round; this
 * round closes the contract-side substrate so the planner refactor
 * has stable pre-resolved namespaces to consume.
 */
describe('PSL → SqlStorage.namespaces qualifier routing (FR15 slice 3 + FR16a end-to-end)', () => {
  // The qualifier hook is active: `createNamespace` now produces
  // target-specific concretions (PostgresUnboundSchema / PostgresSchema)
  // that carry the assembled tables and dispatch qualifyTable correctly.
  it('`namespace unbound { … }` lowers to PostgresUnboundSchema, whose qualifyTable elides the schema prefix', () => {
    const document = parsePslDocument({
      schema: `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      target: postgresTargetPackRef,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table['tenant']).toBeDefined();

    // The storage map carries the Postgres target concretion (not the
    // SQL family placeholder) at the unbound slot.
    const namespace = storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);

    // The qualifier elides — DDL emission against this namespace
    // produces unqualified output that `search_path` resolves at
    // runtime.
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('tenant')).toBe('"tenant"');
  });

  it('`namespace auth { … }` lowers to PostgresSchema("auth"), whose qualifyTable emits `"auth"."<table>"`', () => {
    const document = parsePslDocument({
      schema: `namespace auth {
  model User {
    id Int @id
  }
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      target: postgresTargetPackRef,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['auth']?.entries.table['user']).toBeDefined();

    const namespace = storage.namespaces['auth'];
    expect(namespace).toBeInstanceOf(PostgresSchema);
    expect(namespace).not.toBeInstanceOf(PostgresUnboundSchema);
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('user')).toBe('"auth"."user"');
  });

  it('top-level (implicit) models lower to the public namespace with schema-qualified DDL', () => {
    const document = parsePslDocument({
      schema: `model Post {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      target: postgresTargetPackRef,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['public']?.entries.table['post']).toBeDefined();

    const namespace = storage.namespaces['public'];
    expect(namespace).toBeInstanceOf(PostgresSchema);
    expect(namespace).not.toBeInstanceOf(PostgresUnboundSchema);
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('post')).toBe('"public"."post"');
  });
});
