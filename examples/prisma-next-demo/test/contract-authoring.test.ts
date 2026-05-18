import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';

describe('demo TS contract authoring', () => {
  it('keeps Post.userId storage aligned with User.id', () => {
    const postTable = contract.storage.tables['public']?.post;
    const userTable = contract.storage.tables['auth']?.user;
    if (!postTable || !userTable) throw new Error('expected post and user tables');
    const userIdColumn = postTable.columns.userId;
    const userIdTargetColumn = userTable.columns.id;

    expect(userIdColumn.codecId).toBe(userIdTargetColumn.codecId);
    expect(userIdColumn.nativeType).toBe(userIdTargetColumn.nativeType);
    expect(userIdColumn).toHaveProperty('typeParams', userIdTargetColumn['typeParams']);
  });
});
