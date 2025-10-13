import { describe, it, expect } from 'vitest';
import { createFromBuilder } from '../src/builder';
import { makeT } from '../src/maket';
import { Schema } from '@prisma/relational-ir';

describe('Plan Generation', () => {
  const mockSchema: Schema = {
    target: 'postgres',
    contractHash: 'test-hash-123',
    tables: {
      user: {
        columns: {
          id: { type: 'int4', nullable: false, pk: true },
          email: { type: 'text', nullable: false, unique: true },
          name: { type: 'text', nullable: false },
        },
        indexes: [],
        constraints: [],
        capabilities: [],
      },
      post: {
        columns: {
          id: { type: 'int4', nullable: false, pk: true },
          title: { type: 'text', nullable: false },
          userId: { type: 'int4', nullable: false },
        },
        indexes: [],
        constraints: [],
        capabilities: [],
      },
    },
  };

  it('generates correct Plan structure', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder
      .select({ id: t.user.id, email: t.user.email })
      .where(t.user.id.eq(1))
      .limit(10)
      .build();

    expect(plan).toMatchObject({
      ast: expect.objectContaining({
        type: 'select',
        from: 'user',
        contractHash: 'test-hash-123',
        projectStar: false,
      }),
      sql: expect.stringContaining('SELECT'),
      params: expect.any(Array),
      meta: expect.objectContaining({
        contractHash: 'test-hash-123',
        target: 'postgres',
        refs: expect.objectContaining({
          tables: expect.any(Array),
          columns: expect.any(Array),
        }),
      }),
    });
  });

  it('sets projectStar correctly for SELECT *', () => {
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.build();

    expect(plan.ast.projectStar).toBe(true);
    expect(plan.sql).toContain('SELECT *');
  });

  it('sets projectStar to false for explicit select', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.select({ id: t.user.id }).build();

    expect(plan.ast.projectStar).toBe(false);
    expect(plan.sql).not.toContain('SELECT *');
    expect(plan.sql).toContain('SELECT "id" AS "id"');
  });

  it('extracts table references correctly', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.select({ id: t.user.id, email: t.user.email }).build();

    expect(plan.meta.refs.tables).toEqual(['user']);
  });

  it('extracts column references correctly', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.select({ id: t.user.id, email: t.user.email }).build();

    expect(plan.meta.refs.columns).toEqual(['user.id', 'user.email']);
  });

  it('includes contract hash in meta', () => {
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.build();

    expect(plan.meta.contractHash).toBe('test-hash-123');
    expect(plan.ast.contractHash).toBe('test-hash-123');
  });

  it('includes target in meta', () => {
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.build();

    expect(plan.meta.target).toBe('postgres');
  });

  it('generates immutable AST snapshot', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.select({ id: t.user.id }).build();

    // Modify the original AST
    builder.where(t.user.id.eq(2));

    // Plan AST should be unchanged
    expect(plan.ast.where).toBeUndefined();
  });

  it('handles complex queries with multiple tables', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder
      .select({
        userId: t.user.id,
        userEmail: t.user.email,
        postTitle: t.post.title,
      })
      .build();

    expect(plan.meta.refs.tables).toContain('user');
    expect(plan.meta.refs.columns).toContain('user.id');
    expect(plan.meta.refs.columns).toContain('user.email');
    expect(plan.meta.refs.columns).toContain('post.title');
  });

  it('includes parameters in correct order', () => {
    const t = makeT(mockSchema);
    const builder = createFromBuilder('user', {
      contractHash: 'test-hash-123',
      onContractMismatch: 'error',
    });

    const plan = builder.select({ id: t.user.id }).where(t.user.id.eq(42)).limit(5).build();

    expect(plan.params).toEqual([42, 5]);
    expect(plan.sql).toContain('WHERE "id" = $1');
    expect(plan.sql).toContain('LIMIT $2');
  });
});
