import { coreHash } from '@prisma-next/contract/types';
import { elementCoordinates } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlNamespace } from '../src/ir/build-sql-namespace';
import { SqlStorage } from '../src/ir/sql-storage';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with SqlStorage', () => {
  it('walks SQL namespace tables slot', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('sha256:element-coordinates-sql'),
      namespaces: {
        app: buildSqlNamespace({ id: 'app', tables: { users: emptyTableInput } }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'tables',
      entityName: 'users',
    });
  });
});
