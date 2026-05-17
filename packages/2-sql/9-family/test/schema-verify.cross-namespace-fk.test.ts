/**
 * Cross-namespace FK verification regression.
 *
 * Pins the typology invariant that both sides of an FK comparison
 * always carry a resolved namespace coordinate. A contract FK whose
 * `target.namespaceId === 'auth'` must not silently match a schema FK
 * whose `referencedNamespaceId === 'public'` (the introspection scope
 * stamped by the adapter for a same-schema target). Before the
 * substrate reversal, the verifier collapsed either-side undefined
 * coordinates to a "structural match" — which let cross-namespace
 * mismatches pass.
 */

import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - cross-namespace FK comparator', () => {
  it('surfaces mismatch when contract FK target.namespaceId differs from introspected scope', () => {
    // Contract declares profile.author_id → auth.user(id) (cross-namespace).
    const contract = createTestContract({
      profile: createContractTable(
        {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { columns: ['author_id'] },
              target: { namespaceId: 'auth', table: 'user', columns: ['id'] },
            },
          ],
        },
      ),
    });

    // Schema was introspected under the `public` scope and the FK
    // target lives in the same scope; the adapter stamps
    // `referencedNamespaceId: 'public'` on the schema FK.
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        { id: { nativeType: 'int4', nullable: false } },
        {
          primaryKey: { columns: ['id'] },
          introspectionScope: 'public',
        },
      ),
      profile: createSchemaTable(
        'profile',
        {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['author_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
              referencedNamespaceId: 'public',
            },
          ],
          introspectionScope: 'public',
        },
      ),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'foreign_key_mismatch',
        table: 'profile',
      }),
    );
  });
});
