import { type Contract, coreHash, domainPlaneOf, profileHash } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, type SqlStorageInput } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifyPostgresNamespacePresence } from '../../src/core/migrations/verify-postgres-namespaces';
import { PostgresSchema, PostgresUnboundSchema } from '../../src/core/postgres-schema';

function makeContract(
  namespaceIds: readonly string[],
  options: { useUnbound?: boolean } = {},
): Contract<SqlStorage> {
  const unboundEntry =
    options.useUnbound || !namespaceIds.includes(UNBOUND_NAMESPACE_ID)
      ? PostgresUnboundSchema.instance
      : new PostgresSchema({ id: UNBOUND_NAMESPACE_ID, tables: {} });
  const namespaces: SqlStorageInput['namespaces'] = {
    [UNBOUND_NAMESPACE_ID]: unboundEntry,
    ...Object.fromEntries(
      namespaceIds
        .filter((id) => id !== UNBOUND_NAMESPACE_ID)
        .map((id) => [id, new PostgresSchema({ id, tables: {} })]),
    ),
  };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces,
    }),
    roots: {},
    domain: domainPlaneOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeSchema(existingSchemas?: readonly string[]): SqlSchemaIR {
  if (existingSchemas === undefined) {
    return { tables: {} };
  }
  return {
    tables: {},
    annotations: { pg: { existingSchemas } },
  };
}

describe('verifyPostgresNamespacePresence', () => {
  it('emits missing_schema for a declared namespace whose schema is absent from introspection', () => {
    const contract = makeContract(['auth']);
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'missing_schema',
      namespaceId: 'auth',
    });
    expect(issues[0]?.message).toContain('auth');
  });

  it('does not emit missing_schema when the introspected list already contains the namespace', () => {
    const contract = makeContract(['auth']);
    const schema = makeSchema(['public', 'auth']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('does not emit missing_schema for the always-present public namespace', () => {
    const contract = makeContract(['public']);
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('does not emit missing_schema for the unbound singleton (no creatable schema name)', () => {
    const contract = makeContract([UNBOUND_NAMESPACE_ID], { useUnbound: true });
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('defaults to treating public as present when introspection did not populate existingSchemas', () => {
    const contract = makeContract(['public', 'auth']);
    const schema = makeSchema();

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'missing_schema', namespaceId: 'auth' });
  });

  it('emits a missing_schema for every declared-but-absent namespace in coordinate-sorted order', () => {
    const contract = makeContract(['analytics', 'auth', 'public']);
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => ('namespaceId' in i ? i.namespaceId : undefined))).toEqual([
      'analytics',
      'auth',
    ]);
  });
});
