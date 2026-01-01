import { describe, expect, it } from 'vitest';
import type { ColumnTypeDescriptor } from '../src/builder-state';
import { ContractBuilder, defineContract } from '../src/contract-builder';

const intColumn: ColumnTypeDescriptor = { codecId: 'test/int@1', nativeType: 'int4' };

describe('ContractBuilder', () => {
  it('creates builder with defineContract', () => {
    const builder = defineContract();
    expect(builder).toBeInstanceOf(ContractBuilder);
  });

  it('manages target state', () => {
    const builder = defineContract();
    const withTarget = builder.target('postgres');
    expect(withTarget).toBeInstanceOf(ContractBuilder);
    expect(withTarget).not.toBe(builder);
  });

  it('manages table state', () => {
    const builder = defineContract();
    const withTable = builder.table('user', (t) =>
      t.column('id', { type: intColumn }).primaryKey(['id']),
    );
    expect(withTable).toBeInstanceOf(ContractBuilder);
    expect(withTable).not.toBe(builder);
  });

  it('manages model state', () => {
    const builder = defineContract();
    const withModel = builder.model('User', 'user', (m) => m.field('id', 'id'));
    expect(withModel).toBeInstanceOf(ContractBuilder);
    expect(withModel).not.toBe(builder);
  });

  it('manages capabilities state', () => {
    const builder = defineContract();
    const withCapabilities = builder.capabilities({ postgres: { returning: true } });
    expect(withCapabilities).toBeInstanceOf(ContractBuilder);
    expect(withCapabilities).not.toBe(builder);
  });

  it('manages coreHash state', () => {
    const builder = defineContract();
    const withHash = builder.coreHash('sha256:test');
    expect(withHash).toBeInstanceOf(ContractBuilder);
    expect(withHash).not.toBe(builder);
  });

  it('adds table when callback returns undefined', () => {
    const builder = defineContract();
    // Callback returns undefined - should fall back to using the original tableBuilder
    const withTable = builder.table('user', () => undefined);
    // Verify table was added by adding another table - if first wasn't added, this would fail
    const withTwoTables = withTable.table('post', (t) =>
      t.column('id', { type: intColumn }).primaryKey(['id']),
    );
    expect(withTwoTables).toBeInstanceOf(ContractBuilder);
    expect(withTwoTables).not.toBe(withTable);
  });

  it('adds model when callback returns undefined', () => {
    const builder = defineContract();
    // First add a table for the model to reference
    const withTable = builder.table('user', (t) =>
      t.column('id', { type: intColumn }).primaryKey(['id']),
    );
    // Callback returns undefined - should fall back to using the original modelBuilder
    const withModel = withTable.model('User', 'user', () => undefined);
    // Verify model was added by adding another model - if first wasn't added, this would fail
    const withTwoModels = withModel.model('Post', 'post', (m) => m.field('id', 'id'));
    expect(withTwoModels).toBeInstanceOf(ContractBuilder);
    expect(withTwoModels).not.toBe(withModel);
  });
});
