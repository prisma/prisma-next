import { describe, expect, it } from 'vitest';
import { TableBuilder } from '../src/table-builder';

describe('TableBuilder', () => {
  it('builds table state with columns', () => {
    const builder = new TableBuilder('user');
    const table = builder
      .column('id', { type: 'test/int@1', nullable: false })
      .column('email', { type: 'test/text@1', nullable: true })
      .primaryKey(['id'])
      .build();

    expect(table.name).toBe('user');
    expect(table.columns.id).toEqual({
      name: 'id',
      type: 'test/int@1',
      nullable: false,
    });
    expect(table.columns.email).toEqual({
      name: 'email',
      type: 'test/text@1',
      nullable: true,
    });
    expect(table.primaryKey).toEqual(['id']);
  });

  it('validates type format', () => {
    const builder = new TableBuilder('user');
    expect(() => {
      builder.column('id', { type: 'invalid' });
    }).toThrow('type must be in format "namespace/name@version"');
  });

  it('stores unique constraint', () => {
    const builder = new TableBuilder('user');
    const table = builder.column('email', { type: 'test/text@1' }).unique(['email']).build();

    expect(table.uniques).toEqual([{ columns: ['email'] }]);
  });

  it('stores unique constraint with name', () => {
    const builder = new TableBuilder('user');
    const table = builder
      .column('email', { type: 'test/text@1' })
      .unique(['email'], 'unique_email')
      .build();

    expect(table.uniques).toEqual([{ columns: ['email'], name: 'unique_email' }]);
  });

  it('stores multiple unique constraints', () => {
    const builder = new TableBuilder('user');
    const table = builder
      .column('email', { type: 'test/text@1' })
      .column('username', { type: 'test/text@1' })
      .unique(['email'])
      .unique(['username'])
      .build();

    expect(table.uniques).toEqual([{ columns: ['email'] }, { columns: ['username'] }]);
  });

  it('stores index constraint', () => {
    const builder = new TableBuilder('user');
    const table = builder.column('email', { type: 'test/text@1' }).index(['email']).build();

    expect(table.indexes).toEqual([{ columns: ['email'] }]);
  });

  it('stores index constraint with name', () => {
    const builder = new TableBuilder('user');
    const table = builder
      .column('email', { type: 'test/text@1' })
      .index(['email'], 'idx_email')
      .build();

    expect(table.indexes).toEqual([{ columns: ['email'], name: 'idx_email' }]);
  });

  it('stores foreign key constraint', () => {
    const builder = new TableBuilder('post');
    const table = builder
      .column('userId', { type: 'test/int@1' })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] })
      .build();

    expect(table.foreignKeys).toEqual([
      { columns: ['userId'], references: { table: 'user', columns: ['id'] } },
    ]);
  });

  it('stores foreign key constraint with name', () => {
    const builder = new TableBuilder('post');
    const table = builder
      .column('userId', { type: 'test/int@1' })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'fk_post_user')
      .build();

    expect(table.foreignKeys).toEqual([
      {
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
        name: 'fk_post_user',
      },
    ]);
  });

  it('does not include empty constraint arrays in build output', () => {
    const builder = new TableBuilder('user');
    const table = builder.column('id', { type: 'test/int@1' }).build();

    expect(table.uniques).toBeUndefined();
    expect(table.indexes).toBeUndefined();
    expect(table.foreignKeys).toBeUndefined();
  });
});
