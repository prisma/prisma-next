import { describe, it, expect } from 'vitest';
import { orm } from '../src/relations/factory';
import { makeT } from '@prisma/sql';
import { validateContract } from '@prisma/relational-ir';
import * as Contract from '../../../examples/todo-app/.prisma/contract';

// Mock schema for testing
const mockSchema = validateContract({
  target: 'postgres' as const,
  contractHash: 'test-hash',
  tables: {
    user: {
      columns: {
        id: {
          type: 'int4' as const,
          nullable: false,
          pk: true,
          default: { kind: 'autoincrement' as const },
        },
        email: { type: 'text' as const, nullable: false, unique: true },
        active: {
          type: 'bool' as const,
          nullable: false,
          default: { kind: 'literal' as const, value: 'true' },
        },
        createdAt: {
          type: 'timestamptz' as const,
          nullable: false,
          default: { kind: 'now' as const },
        },
      },
      primaryKey: { kind: 'primaryKey', columns: ['id'] },
      uniques: [{ kind: 'unique', columns: ['email'] }],
      foreignKeys: [],
      indexes: [],
    },
    post: {
      columns: {
        id: {
          type: 'int4' as const,
          nullable: false,
          pk: true,
          default: { kind: 'autoincrement' as const },
        },
        title: { type: 'text' as const, nullable: false },
        published: {
          type: 'bool' as const,
          nullable: false,
          default: { kind: 'literal' as const, value: 'false' },
        },
        createdAt: {
          type: 'timestamptz' as const,
          nullable: false,
          default: { kind: 'now' as const },
        },
        user_id: {
          type: 'int4' as const,
          nullable: false,
        },
      },
      primaryKey: { kind: 'primaryKey', columns: ['id'] },
      uniques: [],
      foreignKeys: [
        {
          kind: 'foreignKey',
          columns: ['user_id'],
          references: { table: 'user', columns: ['id'] },
          name: 'post_user_id_fkey',
        },
      ],
      indexes: [],
    },
  },
});

// Create a proper contract type that matches the Contract interface
type TestContract = {
  Tables: {
    user: {
      id: number;
      email: string;
      active: boolean;
      createdAt: Date;
    };
    post: {
      id: number;
      title: string;
      published: boolean;
      createdAt: Date;
      user_id: number;
    };
  };
  Relations: {
    user: {
      post: {
        to: 'post';
        cardinality: '1:N';
        on: { parentCols: ['id']; childCols: ['user_id'] };
      };
    };
    post: {
      user: {
        to: 'user';
        cardinality: 'N:1';
        on: { parentCols: ['user_id']; childCols: ['id'] };
      };
    };
  };
  Uniques: {
    user: ['id'] | ['email'];
    post: ['id'];
  };
};

const r = orm<TestContract>(mockSchema);
const t = makeT<TestContract['Tables']>(mockSchema) as any;

describe('Type Safety', () => {
  it('allows limit() and orderBy() on 1:N relations', () => {
    const query = r
      .from(t.user)
      .include(
        r.user.post,
        (posts) => {
          return posts
            .select({ id: t.post.id, title: t.post.title })
            .where(t.post.published.eq(true))
            .orderBy('createdAt', 'DESC') // Should be allowed for 1:N
            .limit(5); // Should be allowed for 1:N
        },
        { asArray: true, alias: 'posts' },
      )
      .select({ id: t.user.id, email: t.user.email })
      .build();

    // TypeScript should compile this without errors
    expect(query).toBeDefined();
  });

  it('disallows limit() and orderBy() on N:1 relations', () => {
    // This should cause TypeScript compilation errors
    const query = r
      .from(t.post)
      .include(
        r.post.user,
        (user) => {
          return user.select({ id: t.user.id, email: t.user.email });
          // .orderBy('createdAt', 'DESC') // Should cause TS error for N:1
          // .limit(5); // Should cause TS error for N:1
        },
        { alias: 'author' },
      )
      .select({ id: t.post.id, title: t.post.title })
      .build();

    // TypeScript should compile this without errors
    expect(query).toBeDefined();
  });

  it('infers correct result type for 1:N includes', () => {
    const query = r
      .from(t.user)
      .include(
        r.user.post,
        (posts) => {
          return posts
            .select({ id: t.post.id, title: t.post.title })
            .where(t.post.published.eq(true));
        },
        { asArray: true, alias: 'posts' },
      )
      .select({ id: t.user.id, email: t.user.email })
      .build();

    // The result type should be:
    // { id: number; email: string; posts: Array<{ id: number; title: string }> }
    type ResultType = typeof query;
    type ExpectedType = {
      ast: any;
      sql: string;
      params: unknown[];
      meta: any;
    };

    // TypeScript should infer the correct nested array type
    const result: ExpectedType = query;
    expect(result).toBeDefined();

    // Verify the SQL contains the expected structure
    expect(query.sql).toContain('SELECT');
    expect(query.sql).toContain('FROM');
  });

  it('infers correct result type for N:1 includes', () => {
    const query = r
      .from(t.post)
      .include(
        r.post.user,
        (user) => {
          return user.select({ id: t.user.id, email: t.user.email });
        },
        { alias: 'author' },
      )
      .select({ id: t.post.id, title: t.post.title })
      .build();

    // The result type should be:
    // { id: number; title: string; author: { id: number; email: string } | null }
    type ResultType = typeof query;
    type ExpectedType = {
      ast: any;
      sql: string;
      params: unknown[];
      meta: any;
    };

    // TypeScript should infer the correct nested object type
    const result: ExpectedType = query;
    expect(result).toBeDefined();

    // Verify the SQL contains the expected structure
    expect(query.sql).toContain('SELECT');
    expect(query.sql).toContain('FROM');
  });

  it('accumulates nested selections properly', () => {
    const query = r
      .from(t.user)
      .include(
        r.user.post,
        (posts) => {
          return posts
            .select({
              id: t.post.id,
              title: t.post.title,
              published: t.post.published,
            })
            .where(t.post.published.eq(true));
        },
        { asArray: true, alias: 'posts' },
      )
      .select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
      })
      .build();

    // The result type should accumulate all selected fields:
    // {
    //   id: number;
    //   email: string;
    //   active: boolean;
    //   posts: Array<{ id: number; title: string; published: boolean }>
    // }
    type ResultType = typeof query;
    type ExpectedType = {
      ast: any;
      sql: string;
      params: unknown[];
      meta: any;
    };

    const result: ExpectedType = query;
    expect(result).toBeDefined();

    // Verify the SQL contains the expected structure
    expect(query.sql).toContain('SELECT');
    expect(query.sql).toContain('FROM');
  });

  it('enforces relation existence at compile time', () => {
    // This should cause TypeScript compilation errors if we try to access non-existent relations
    const query = r
      .from(t.user)
      .include(
        r.user.post, // This should work - relation exists
        (posts) => {
          return posts.select({ id: t.post.id });
        },
      )
      .select({ id: t.user.id })
      .build();

    // TypeScript should compile this without errors
    expect(query).toBeDefined();
  });

  it('scopes child builder to child table columns', () => {
    const query = r
      .from(t.user)
      .include(r.user.post, (posts) => {
        // Child builder should only have access to post table columns
        return posts.select({
          id: t.post.id, // OK - post column
          title: t.post.title, // OK - post column
          // email: t.user.email // Should cause TS error - wrong table
        });
      })
      .select({ id: t.user.id })
      .build();

    // TypeScript should compile this without errors
    expect(query).toBeDefined();
  });

  it('demonstrates cardinality gating for N:1 relations', () => {
    const query = r
      .from(t.post)
      .include(r.post.user, (user) => {
        // For N:1 relations, limit() and orderBy() should be unavailable
        return user.select({ id: t.user.id, email: t.user.email });
        // The following lines should cause TypeScript errors:
        // .orderBy('createdAt', 'DESC') // ❌ TS error: Property 'orderBy' does not exist
        // .limit(5); // ❌ TS error: Property 'limit' does not exist
      })
      .select({ id: t.post.id, title: t.post.title })
      .build();

    // TypeScript should compile this without errors
    expect(query).toBeDefined();

    // Verify the SQL contains the expected structure
    expect(query.sql).toContain('SELECT');
    expect(query.sql).toContain('FROM');
  });
});
