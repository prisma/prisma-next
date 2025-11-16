import { describe, expect, it } from 'vitest';
import type { ControlPlaneDriver, ExtensionSchemaVerifierOptions } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import pgvectorExtensionDescriptor from '../src/exports/cli';

/**
 * Creates a mock ControlPlaneDriver for testing.
 */
function createMockDriver(
  responses: Array<{ sql: string; rows: unknown[] }>,
): ControlPlaneDriver {
  let callIndex = 0;
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ readonly rows: Row[] }> {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`Unexpected query call ${callIndex}: ${sql}`);
      }
      callIndex++;
      return { rows: response.rows as Row[] };
    },
    async close(): Promise<void> {
      // No-op
    },
  };
}

describe('pgvector verifySchema hook', () => {
  it('returns no issues when vector extension is installed', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT extname',
        rows: [{ extname: 'vector' }],
      },
    ]);

    const schemaIR: SqlSchemaIR = {
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nativeType: 'integer',
              nullable: false,
            },
            embedding: {
              name: 'embedding',
              typeId: 'pg/vector@1',
              nativeType: 'vector',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: ['vector'],
    };

    const contractIR = {
      target: 'postgres',
      storage: {
        tables: {
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              embedding: { type: 'pg/vector@1', nullable: false },
            },
          },
        },
      },
    };

    const options: ExtensionSchemaVerifierOptions = {
      driver,
      contractIR,
      schemaIR,
      strict: false,
    };

    if (!pgvectorExtensionDescriptor.verifySchema) {
      throw new Error('verifySchema hook not implemented');
    }

    const issues = await pgvectorExtensionDescriptor.verifySchema(options);

    expect(issues).toHaveLength(0);
  });

  it('reports issue when vector extension is missing', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT extname',
        rows: [],
      },
    ]);

    const schemaIR: SqlSchemaIR = {
      tables: {},
      extensions: [],
    };

    const contractIR = {
      target: 'postgres',
      storage: {
        tables: {
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              embedding: { type: 'pg/vector@1', nullable: false },
            },
          },
        },
      },
    };

    const options: ExtensionSchemaVerifierOptions = {
      driver,
      contractIR,
      schemaIR,
      strict: false,
    };

    if (!pgvectorExtensionDescriptor.verifySchema) {
      throw new Error('verifySchema hook not implemented');
    }

    const issues = await pgvectorExtensionDescriptor.verifySchema(options);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('extension_missing');
    expect(issues[0]?.message).toContain('vector');
  });

  it('reports issue when vector column has incompatible nativeType', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT extname',
        rows: [{ extname: 'vector' }],
      },
    ]);

    const schemaIR: SqlSchemaIR = {
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              typeId: 'pg/int4@1',
              nativeType: 'integer',
              nullable: false,
            },
            embedding: {
              name: 'embedding',
              typeId: 'pg/vector@1',
              nativeType: 'text', // Wrong nativeType - should be 'vector'
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: ['vector'],
    };

    const contractIR = {
      target: 'postgres',
      storage: {
        tables: {
          post: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              embedding: { type: 'pg/vector@1', nullable: false },
            },
          },
        },
      },
    };

    const options: ExtensionSchemaVerifierOptions = {
      driver,
      contractIR,
      schemaIR,
      strict: false,
    };

    if (!pgvectorExtensionDescriptor.verifySchema) {
      throw new Error('verifySchema hook not implemented');
    }

    const issues = await pgvectorExtensionDescriptor.verifySchema(options);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.kind === 'type_mismatch')).toBe(true);
  });
});

