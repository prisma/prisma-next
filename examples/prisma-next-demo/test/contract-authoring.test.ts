import { describe, expect, it } from 'vitest';
import { contract } from '../prisma/contract';

describe('demo TS contract authoring', () => {
  it('keeps Post.userId storage aligned with User.id', () => {
    // In the TS-authoring path all tables are typed in __unbound__ at the
    // type level (namespace literals are not preserved through the builder
    // constructor). The runtime shape is correct; access via __unbound__ here.
    const userIdColumn = contract.storage.namespaces.__unbound__.tables.post.columns.userId;
    const userIdTargetColumn = contract.storage.namespaces.__unbound__.tables.user.columns.id;

    expect(userIdColumn.codecId).toBe(userIdTargetColumn.codecId);
    expect(userIdColumn.nativeType).toBe(userIdTargetColumn.nativeType);
    expect(userIdColumn).toHaveProperty('typeParams', userIdTargetColumn['typeParams']);
  });
});
