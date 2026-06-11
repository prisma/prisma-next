import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlNamespace, buildSqlNamespaceMap } from '../src/ir/build-sql-namespace';
import { SqlUnboundNamespace } from '../src/ir/sql-unbound-namespace';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('buildSqlNamespaceMap', () => {
  it('passes through a materialised namespace without re-wrapping tables', () => {
    const built = buildSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } });
    const map = buildSqlNamespaceMap({ app: built });
    expect(map.app).toBe(built);
  });

  it('materialises plain tables-input entries', () => {
    const map = buildSqlNamespaceMap({
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
      app: { id: 'app', entries: { table: { users: emptyTableInput } } },
    });
    expect(map[UNBOUND_NAMESPACE_ID]).toBe(SqlUnboundNamespace.instance);
    expect(map.app.id).toBe('app');
    expect(map.app!.entries.table?.['users']).toBeDefined();
  });
});
