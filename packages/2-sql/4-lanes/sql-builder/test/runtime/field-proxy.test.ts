import { ColumnRef, IdentifierRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { joinedScope, usersScope } from './test-helpers';

describe('createFieldProxy', () => {
  it('top-level field access produces IdentifierRef', () => {
    const proxy = createFieldProxy(usersScope);
    const idExpr = proxy.id;

    expect(idExpr).toBeInstanceOf(ExpressionImpl);
    const ref = idExpr.buildAst();
    expect(ref).toBeInstanceOf(IdentifierRef);
    expect((ref as IdentifierRef).name).toBe('id');
    expect((idExpr as ExpressionImpl).field).toEqual({ codecId: 'pg/int4@1', nullable: false });
  });

  it('namespaced field access produces ColumnRef', () => {
    const proxy = createFieldProxy(usersScope);
    const emailExpr = proxy.users.email;

    expect(emailExpr).toBeInstanceOf(ExpressionImpl);
    const col = emailExpr.buildAst() as ColumnRef;
    expect(col).toBeInstanceOf(ColumnRef);
    expect(col.table).toBe('users');
    expect(col.column).toBe('email');
  });

  it('handles joined scope with namespaced access', () => {
    const proxy = createFieldProxy(joinedScope);
    const usersCol = proxy.users.id.buildAst() as ColumnRef;
    const postsCol = proxy.posts.id.buildAst() as ColumnRef;

    expect(usersCol.table).toBe('users');
    expect(usersCol.column).toBe('id');
    expect(postsCol.table).toBe('posts');
    expect(postsCol.column).toBe('id');
  });

  it('returns undefined for unknown fields', () => {
    const proxy = createFieldProxy(usersScope);
    expect((proxy as Record<string, unknown>)['nonexistent']).toBeUndefined();
  });
});
