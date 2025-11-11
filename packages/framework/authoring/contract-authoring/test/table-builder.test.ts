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

  it('supports unique method', () => {
    const builder = new TableBuilder('user');
    const result = builder.column('email', { type: 'test/text@1' }).unique(['email']);
    expect(result).toBeInstanceOf(TableBuilder);
  });

  it('supports index method', () => {
    const builder = new TableBuilder('user');
    const result = builder.column('email', { type: 'test/text@1' }).index(['email']);
    expect(result).toBeInstanceOf(TableBuilder);
  });

  it('supports foreignKey method', () => {
    const builder = new TableBuilder('post');
    const result = builder
      .column('userId', { type: 'test/int@1' })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] });
    expect(result).toBeInstanceOf(TableBuilder);
  });
});
