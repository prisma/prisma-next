import { describe, it, expect } from 'vitest';
import { typedOrm } from '@prisma/orm';
import { makeT } from '@prisma/sql';
import contract from '../.prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma/relational-ir';

const ir = validateContract(contract);
const r = typedOrm(ir);
const t = makeT(ir);

describe('ORM Type Safety and Runtime Structure', () => {
  it('provides type-safe relation handles', () => {
    // These should be properly typed
    const userPostRelation = r.user.post;
    const postUserRelation = r.post.user;

    expect(userPostRelation).toEqual({
      parent: 'user',
      child: 'post',
      cardinality: '1:N',
      on: { parentCols: ['id'], childCols: ['user_id'] },
      name: 'post',
    });

    expect(postUserRelation).toEqual({
      parent: 'post',
      child: 'user',
      cardinality: 'N:1',
      on: { parentCols: ['user_id'], childCols: ['id'] },
      name: 'user',
    });
  });

  it('provides type-safe relation builder in include callback', () => {
    const query = r
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .include(
        r.user.post,
        (posts) => {
          // The 'posts' parameter should be properly typed as TypedRelationBuilder<'post'>
          // It should have the same methods as the main builder but scoped to the post table
          expect(typeof posts.select).toBe('function');
          expect(typeof posts.where).toBe('function');
          expect(typeof posts.orderBy).toBe('function');
          expect(typeof posts.limit).toBe('function');
          expect(typeof posts.getAst).toBe('function');

          return posts
            .select({ id: t.post.id, title: t.post.title })
            .where(t.post.published.eq(true))
            .orderBy('createdAt', 'DESC')
            .limit(5);
        },
        { asArray: true, alias: 'posts' },
      )
      .build();

    // Verify the SQL structure
    expect(query.sql).toContain('SELECT "id" AS "id", "email" AS "email"');
    expect(query.sql).toContain('COALESCE((SELECT json_agg(json_build_object');
    expect(query.sql).toContain('FROM post WHERE user_id = $1');
    expect(query.sql).toContain('ORDER BY "createdAt" DESC LIMIT $2');
    expect(query.sql).toContain("), '[]') AS posts FROM \"user\"");
  });

  it('provides type-safe N:1 relation builder', () => {
    const query = r
      .from(t.post)
      .select({ id: t.post.id, title: t.post.title })
      .include(
        r.post.user,
        (user) => {
          // The 'user' parameter should be properly typed as TypedRelationBuilder<'user'>
          expect(typeof user.select).toBe('function');
          expect(typeof user.where).toBe('function');
          expect(typeof user.orderBy).toBe('function');
          expect(typeof user.limit).toBe('function');

          return user.select({ id: t.user.id, email: t.user.email });
        },
        { alias: 'author' },
      )
      .build();

    // Verify the SQL structure for N:1
    expect(query.sql).toContain('SELECT "id" AS "id", title AS title');
    expect(query.sql).toContain('author."id" AS author__id');
    expect(query.sql).toContain('author."email" AS author__email');
    expect(query.sql).toContain('FROM post LEFT JOIN "user" author ON author.id = post.user_id');
  });

  it('validates result structure for 1:N queries', () => {
    const query = r
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .include(
        r.user.post,
        (posts) =>
          posts
            .select({ id: t.post.id, title: t.post.title })
            .where(t.post.published.eq(true))
            .limit(3),
        { asArray: true, alias: 'posts' },
      )
      .build();

    // The result should have this structure:
    // {
    //   id: number,
    //   email: string,
    //   posts: Array<{ id: number, title: string }>
    // }

    // Verify the SQL generates the correct structure
    expect(query.sql).toContain('json_agg(json_build_object(\'id\', "id", \'title\', title))');
    expect(query.sql).toContain("COALESCE(..., '[]') AS posts");
    
    // Verify parameters
    expect(query.params).toHaveLength(2);
    expect(query.params[0]).toEqual({ kind: 'column', table: 'user', name: 'id' });
    expect(query.params[1]).toBe(3);
  });

  it('validates result structure for N:1 queries', () => {
    const query = r
      .from(t.post)
      .select({ id: t.post.id, title: t.post.title })
      .include(
        r.post.user,
        (user) => user.select({ id: t.user.id, email: t.user.email }),
        { alias: 'author' },
      )
      .build();

    // The result should have this structure:
    // {
    //   id: number,
    //   title: string,
    //   author__id: number,
    //   author__email: string
    // }

    // Verify the SQL generates the correct structure
    expect(query.sql).toContain('author."id" AS author__id');
    expect(query.sql).toContain('author."email" AS author__email');
    expect(query.sql).toContain('LEFT JOIN "user" author ON author.id = post.user_id');
  });

  it('enforces cardinality-based method restrictions', () => {
    // For 1:N relations, asArray should be allowed
    const oneToManyQuery = r
      .from(t.user)
      .select({ id: t.user.id })
      .include(
        r.user.post,
        (posts) => posts.select({ id: t.post.id }),
        { asArray: true }, // This should be allowed for 1:N
      )
      .build();

    expect(oneToManyQuery.sql).toContain('json_agg');

    // For N:1 relations, asArray should be ignored (always flat)
    const manyToOneQuery = r
      .from(t.post)
      .select({ id: t.post.id })
      .include(
        r.post.user,
        (user) => user.select({ id: t.user.id }),
        { asArray: true }, // This should be ignored for N:1
      )
      .build();

    expect(manyToOneQuery.sql).toContain('LEFT JOIN');
    expect(manyToOneQuery.sql).not.toContain('json_agg');
  });

  it('maintains contract hash verification', () => {
    const query = r
      .from(t.user)
      .select({ id: t.user.id })
      .build();

    expect(query.meta.contractHash).toBe(ir.contractHash);
    expect(query.ast.contractHash).toBe(ir.contractHash);
  });
});
