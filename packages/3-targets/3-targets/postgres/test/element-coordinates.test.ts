import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../src/core/postgres-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with PostgresSchema', () => {
  it('walks Postgres-promoted namespace (kind === schema)', () => {
    const schema = new PostgresSchema({
      id: 'public',
      tables: { users: emptyTableInput },
    });
    expect(schema.kind).toBe('schema');

    const storage = new SqlStorage({
      storageHash: coreHash('sha256:element-coordinates-test'),
      namespaces: { public: schema },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      namespaceId: 'public',
      entityKind: 'tables',
      entityName: 'users',
    });
  });
});
