import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqliteUnboundDatabase } from '../src/core/sqlite-unbound-database';

describe('SqliteUnboundDatabase', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(SqliteUnboundDatabase.instance.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('elides every qualifier — SQLite has no schema concept and emits unqualified DDL', () => {
    expect(SqliteUnboundDatabase.instance.qualifier()).toBe('');
    expect(SqliteUnboundDatabase.instance.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(SqliteUnboundDatabase.instance).toBe(SqliteUnboundDatabase.instance);
  });
});
