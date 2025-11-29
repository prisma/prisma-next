import { describe, expect, it } from 'vitest';
import type { ColumnTypeDescriptor } from '../src/builder-state';
import { TableBuilder } from '../src/table-builder';

const intColumn: ColumnTypeDescriptor = { codecId: 'test/int@1', nativeType: 'int4' };
const textColumn: ColumnTypeDescriptor = { codecId: 'test/text@1', nativeType: 'text' };

describe('TableBuilder', () => {
  it('builds table state with columns', () => {
    const builder = new TableBuilder('user');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .column('email', { type: textColumn, nullable: true })
      .primaryKey(['id'])
      .build();

    expect(table.name).toBe('user');
    expect(table.columns.id).toEqual({
      name: 'id',
      type: 'test/int@1',
      nullable: false,
      nativeType: 'int4',
    });
    expect(table.columns.email).toEqual({
      name: 'email',
      type: 'test/text@1',
      nullable: true,
      nativeType: 'text',
    });
    expect(table.primaryKey).toEqual(['id']);
  });

  it('supports unique method', () => {
    const builder = new TableBuilder('user');
    const result = builder.column('email', { type: textColumn }).unique(['email']);
    expect(result).toBeInstanceOf(TableBuilder);
  });

  it('supports index method', () => {
    const builder = new TableBuilder('user');
    const result = builder.column('email', { type: textColumn }).index(['email']);
    expect(result).toBeInstanceOf(TableBuilder);
  });

  it('supports foreignKey method', () => {
    const builder = new TableBuilder('post');
    const result = builder
      .column('userId', { type: intColumn })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] });
    expect(result).toBeInstanceOf(TableBuilder);
  });
});
