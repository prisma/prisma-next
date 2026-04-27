import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';

describe('demo TS contract authoring', () => {
  it('keeps Post.userId storage aligned with User.id', () => {
    const userIdColumn = contract.storage.tables.post.columns.userId;
    const userIdTargetColumn = contract.storage.tables.user.columns.id;

    expect(userIdColumn.codecId).toBe(userIdTargetColumn.codecId);
    expect(userIdColumn.nativeType).toBe(userIdTargetColumn.nativeType);
    expect(userIdColumn).toHaveProperty('typeParams', userIdTargetColumn['typeParams']);
  });

  it('targets sqlite', () => {
    expect(contract.target).toBe('sqlite');
    expect(contract.targetFamily).toBe('sql');
  });

  it('declares SQLite capabilities (returning, jsonAgg, no enums, no lateral)', () => {
    const sqlCaps = contract.capabilities['sql'] as Record<string, boolean> | undefined;
    expect(sqlCaps?.['returning']).toBe(true);
    expect(sqlCaps?.['jsonAgg']).toBe(true);
    expect(sqlCaps?.['lateral']).toBe(false);
    expect(sqlCaps?.['enums']).toBe(false);
  });
});
