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
});
