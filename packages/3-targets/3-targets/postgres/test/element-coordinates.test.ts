import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresSchema, PostgresUnboundSchema } from '../src/core/postgres-schema';

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
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
        public: schema,
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'tables',
      entityName: 'users',
    });
  });
});
