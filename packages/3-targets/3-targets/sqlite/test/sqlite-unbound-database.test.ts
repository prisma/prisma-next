import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  SqliteDatabase,
  SqliteUnboundDatabase,
  sqliteCreateNamespace,
} from '../src/core/sqlite-unbound-database';

describe('SqliteUnboundDatabase', () => {
  it('materializes kind non-enumerably as sqlite-namespace', () => {
    expect(SqliteUnboundDatabase.instance.kind).toBe('sqlite-namespace');
    expect(Object.keys(SqliteUnboundDatabase.instance)).not.toContain('kind');
  });

  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(SqliteUnboundDatabase.instance.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries an empty frozen tables map', () => {
    expect(SqliteUnboundDatabase.instance.entries.table).toEqual({});
    expect(Object.isFrozen(SqliteUnboundDatabase.instance.entries.table)).toBe(true);
  });

  it('elides every qualifier — SQLite has no schema concept and emits unqualified DDL', () => {
    expect(SqliteUnboundDatabase.instance.qualifier()).toBe('');
    expect(SqliteUnboundDatabase.instance.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(SqliteUnboundDatabase.instance).toBe(SqliteUnboundDatabase.instance);
  });
});

describe('SqliteDatabase', () => {
  it('qualifies table names without a schema prefix for runtime SQL rendering', () => {
    const database = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          user: new StorageTable({
            columns: {
              id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          }),
        },
      },
    });
    expect(database.qualifyTable('user')).toBe('"user"');
  });
});

describe('sqliteCreateNamespace factory', () => {
  it('returns the unbound singleton for the framework-reserved sentinel', () => {
    expect(sqliteCreateNamespace({ id: UNBOUND_NAMESPACE_ID })).toBe(
      SqliteUnboundDatabase.instance,
    );
  });

  it('rejects every non-unbound coordinate — SQLite contracts cannot declare named namespaces', () => {
    expect(() => sqliteCreateNamespace({ id: 'auth' })).toThrow(/SQLite has no schema concept/);
  });
});
