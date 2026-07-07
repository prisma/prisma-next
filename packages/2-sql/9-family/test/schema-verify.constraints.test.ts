import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
} from './schema-verify.helpers';

describe('collectSqlSchemaIssues - constraints', () => {
  describe('primary key mismatch', () => {
    it('returns primary_key_mismatch issue when PK is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable(
          { id: { nativeType: 'int4', nullable: false } },
          { primaryKey: { columns: ['id'] } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
        }),
        // No primaryKey in schema
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'primary_key_mismatch',
          table: 'user',
        }),
      );
    });
  });

  describe('foreign key mismatch', () => {
    it('returns foreign_key_mismatch issue when FK is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['author_id'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
        // No foreignKey in schema
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'foreign_key_mismatch',
          table: 'post',
        }),
      );
    });

    describe('cross-space FK (public.profile.user_id -> auth.users.id)', () => {
      it('returns zero issues when cross-space FK matches introspected pg_constraint row', () => {
        const contract = createTestContract({
          profile: createContractTable(
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  source: {
                    namespaceId: UNBOUND_NAMESPACE_ID,
                    tableName: 'profile',
                    columns: ['user_id'],
                  },
                  target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
                  constraint: true,
                  index: false,
                },
              ],
            },
          ),
        });

        const schema = createTestSchemaIR({
          profile: createSchemaTable(
            'profile',
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  columns: ['user_id'],
                  referencedTable: 'users',
                  referencedSchema: 'auth',
                  referencedColumns: ['id'],
                },
              ],
            },
          ),
        });

        const issues = collectSqlSchemaIssues({
          contract,
          schema,
          strict: false,
          frameworkComponents: [],
        });

        expect(issues).toEqual([]);
      });

      it('returns foreign_key_mismatch when introspected FK has wrong referencedColumns', () => {
        const contract = createTestContract({
          profile: createContractTable(
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  source: {
                    namespaceId: UNBOUND_NAMESPACE_ID,
                    tableName: 'profile',
                    columns: ['user_id'],
                  },
                  target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
                  constraint: true,
                  index: false,
                },
              ],
            },
          ),
        });

        const schema = createTestSchemaIR({
          profile: createSchemaTable(
            'profile',
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  columns: ['user_id'],
                  referencedTable: 'users',
                  referencedSchema: 'auth',
                  // Wrong column — should be 'id'
                  referencedColumns: ['email'],
                },
              ],
            },
          ),
        });

        const issues = collectSqlSchemaIssues({
          contract,
          schema,
          strict: false,
          frameworkComponents: [],
        });

        expect(issues).toContainEqual(
          expect.objectContaining({
            kind: 'foreign_key_mismatch',
            table: 'profile',
          }),
        );
      });

      it('emits no missing_table issue for auth.users because the app verifier never inspects auth', () => {
        const contract = createTestContract({
          profile: createContractTable(
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  source: {
                    namespaceId: UNBOUND_NAMESPACE_ID,
                    tableName: 'profile',
                    columns: ['user_id'],
                  },
                  target: { namespaceId: 'auth', tableName: 'users', columns: ['id'] },
                  constraint: true,
                  index: false,
                },
              ],
            },
          ),
        });

        // Schema has no entry for auth.users — it is outside the app's SqlSchemaIR
        const schema = createTestSchemaIR({
          profile: createSchemaTable(
            'profile',
            {
              id: { nativeType: 'int4', nullable: false },
              user_id: { nativeType: 'uuid', nullable: false },
            },
            {
              foreignKeys: [
                {
                  columns: ['user_id'],
                  referencedTable: 'users',
                  referencedSchema: 'auth',
                  referencedColumns: ['id'],
                },
              ],
            },
          ),
        });

        const issues = collectSqlSchemaIssues({
          contract,
          schema,
          strict: false,
          frameworkComponents: [],
        });

        const missingAuthUsers = issues.filter(
          (i) => i.kind === 'missing_table' && i.table === 'users' && i.namespaceId === 'auth',
        );
        expect(missingAuthUsers).toHaveLength(0);
      });
    });
  });

  describe('unique constraint mismatch', () => {
    it('returns unique_constraint_mismatch issue when unique constraint is missing', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            email: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['email'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
        // No unique constraint in schema
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'unique_constraint_mismatch',
          table: 'user',
        }),
      );
    });

    it('returns unique_constraint_mismatch for missing composite unique constraint', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          first_name: { nativeType: 'text', nullable: false },
          last_name: { nativeType: 'text', nullable: false },
        }),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'unique_constraint_mismatch',
          table: 'user',
        }),
      );
    });

    it('passes when composite unique constraint matches', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            id: { nativeType: 'int4', nullable: false },
            first_name: { nativeType: 'text', nullable: false },
            last_name: { nativeType: 'text', nullable: false },
          },
          { uniques: [{ columns: ['first_name', 'last_name'], name: 'user_name_key' }] },
        ),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toEqual([]);
    });
  });

  describe('FK with constraint: false', () => {
    it('skips FK constraint verification when constraint=false', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['author_id'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                constraint: false,
                index: false,
              },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
        // No FK in schema — should pass because constraint=false
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues.filter((i) => i.kind === 'foreign_key_mismatch')).toHaveLength(0);
    });

    it('still reports FK constraint mismatch when constraint=true', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['author_id'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                constraint: true,
                index: false,
              },
            ],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'foreign_key_mismatch',
          table: 'post',
        }),
      );
    });

    it('verifies user-declared indexes regardless of FK index flag', () => {
      const contract = createTestContract({
        user: createContractTable({ id: { nativeType: 'int4', nullable: false } }),
        post: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            author_id: { nativeType: 'int4', nullable: false },
          },
          {
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['author_id'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                constraint: false,
                index: false,
              },
            ],
            indexes: [{ columns: ['author_id'] }],
          },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
        post: createSchemaTable('post', {
          id: { nativeType: 'int4', nullable: false },
          author_id: { nativeType: 'int4', nullable: false },
        }),
        // No index in schema — should fail because user declared the index
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'index_mismatch',
          table: 'post',
        }),
      );
    });
  });

  describe('index mismatch', () => {
    it('returns index_mismatch issue when index is missing in schema', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            id: { nativeType: 'int4', nullable: false },
            created_at: { nativeType: 'timestamptz', nullable: false },
          },
          { indexes: [{ columns: ['created_at'] }] },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          created_at: { nativeType: 'timestamptz', nullable: false },
        }),
        // No index in schema
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'index_mismatch',
          table: 'user',
        }),
      );
    });
  });
});
