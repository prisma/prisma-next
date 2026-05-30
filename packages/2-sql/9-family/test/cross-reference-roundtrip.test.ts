import { createSqlContract } from '@prisma-next/contract/testing';
import { CrossReferenceSchema, crossRef } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { SqlContractSerializer } from '../src/core/ir/sql-contract-serializer';

describe('cross-reference shape round-trip', () => {
  it('parses and round-trips through SQL family serializer hydration', () => {
    const rootsCrossRef = crossRef('User', 'public');
    const relationCrossRef = crossRef('Post', 'public');
    const baseCrossRef = crossRef('User', 'public');
    expect(CrossReferenceSchema(rootsCrossRef) instanceof type.errors).toBe(false);

    const envelope = createSqlContract({
      roots: { users: rootsCrossRef },
      models: {
        User: {
          fields: { kind: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
          discriminator: { field: 'kind' },
          variants: { Post: { value: 'post' } },
          relations: {
            posts: {
              to: relationCrossRef,
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['authorId'] },
            },
          },
          storage: { table: 'user', fields: { kind: { column: 'kind' } } },
        },
        Post: {
          fields: {},
          relations: {},
          storage: { table: 'user', fields: {} },
          base: baseCrossRef,
        },
      },
      storage: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          tables: {
            user: {
              columns: {
                kind: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {},
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    });

    const serializer = new SqlContractSerializer();
    const hydrated = serializer.deserializeContract(JSON.parse(JSON.stringify(envelope)));
    const serialized = JSON.parse(JSON.stringify(serializer.serializeContract(hydrated)));

    expect(serialized.roots.users).toEqual(rootsCrossRef);
    expect(serialized.models.User.relations.posts.to).toEqual(relationCrossRef);
    expect(serialized.models.Post.base).toEqual(baseCrossRef);
  });
});
