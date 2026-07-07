import { describe, expect, it } from 'vitest';
import { collectSqlSchemaIssues } from '../src/core/diff/sql-schema-diff';
import {
  createContractTable,
  createMockPostgresComponent,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
} from './schema-verify.helpers';

describe('collectSqlSchemaIssues - basic', () => {
  describe('matching schema', () => {
    it('returns no issues when schema matches contract', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toEqual([]);
    });

    it('treats parameterized native types as matching when expanded', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            email: {
              nativeType: 'character varying',
              codecId: 'sql/varchar@1',
              nullable: false,
              typeParams: { length: 255 },
            },
          },
          { primaryKey: { columns: ['email'] } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            email: { nativeType: 'character varying(255)', nullable: false },
          },
          {
            primaryKey: { columns: ['email'] },
          },
        ),
      });

      // Use mock postgres component to provide the expandNativeType hook
      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [createMockPostgresComponent()],
      });

      expect(issues).toEqual([]);
    });

    it('treats parameterized named storage type refs as matching when expanded', () => {
      const contract = createTestContract(
        {
          document: {
            columns: {
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeRef: 'Embedding1536',
              },
            },
            primaryKey: { columns: ['embedding'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        {},
        {
          Embedding1536: {
            kind: 'codec-instance',
            nativeType: 'vector',
            codecId: 'pg/vector@1',
            typeParams: { length: 1536 },
          },
        },
      );

      const schema = createTestSchemaIR({
        document: createSchemaTable(
          'document',
          {
            embedding: { nativeType: 'vector(1536)', nullable: false },
          },
          {
            primaryKey: { columns: ['embedding'] },
          },
        ),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [createMockPostgresComponent()],
      });

      expect(issues).toEqual([]);
    });

    it('fails fast when a column typeRef points at a missing storage type', () => {
      const contract = createTestContract({
        document: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeRef: 'MissingEmbedding',
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      });

      const schema = createTestSchemaIR({
        document: createSchemaTable(
          'document',
          {
            embedding: { nativeType: 'vector', nullable: false },
          },
          {
            primaryKey: { columns: ['embedding'] },
          },
        ),
      });

      expect(() =>
        collectSqlSchemaIssues({
          contract,
          schema,
          strict: false,
          frameworkComponents: [],
        }),
      ).toThrow(
        'Column "document"."embedding" references storage type "MissingEmbedding" but it is not defined in storage.types.',
      );
    });

    it('reports type mismatch when schema omits parameters', () => {
      const contract = createTestContract({
        user: createContractTable(
          {
            email: {
              nativeType: 'character varying',
              codecId: 'sql/varchar@1',
              nullable: false,
              typeParams: { length: 255 },
            },
          },
          { primaryKey: { columns: ['email'] } },
        ),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable(
          'user',
          {
            email: { nativeType: 'character varying', nullable: false },
          },
          {
            primaryKey: { columns: ['email'] },
          },
        ),
      });

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [createMockPostgresComponent()],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'type_mismatch',
          table: 'user',
          column: 'email',
          expected: 'character varying(255)',
          actual: 'character varying',
        }),
      );
    });
  });

  describe('missing table', () => {
    it('returns missing_table issue when contract table is not in schema', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({});

      const issues = collectSqlSchemaIssues({
        contract,
        schema,
        strict: false,
        frameworkComponents: [],
      });

      expect(issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_table',
          table: 'user',
        }),
      );
    });
  });

  describe('missing column', () => {
    it('returns missing_column issue when contract column is not in schema table', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          // email column missing
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
          kind: 'missing_column',
          table: 'user',
          column: 'email',
        }),
      );
    });
  });

  describe('type mismatch', () => {
    it('returns type_mismatch issue when column types differ', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int8', nullable: false }, // Different type
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
          kind: 'type_mismatch',
          table: 'user',
          column: 'id',
          expected: 'int4',
          actual: 'int8',
        }),
      );
    });
  });

  describe('nullability mismatch', () => {
    it('returns nullability_mismatch issue when nullability differs', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: true }, // Different nullability
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
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'id',
        }),
      );
    });
  });
});
