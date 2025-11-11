import { describe, expect, it } from 'vitest';
import { ContractBuilder, defineContract } from '../src/contract-builder';

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
      t.column('id', { type: 'test/int@1' }).primaryKey(['id']),
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

  it('manages extensions state', () => {
    const builder = defineContract();
    const withExtensions = builder.extensions({ postgres: {} });
    expect(withExtensions).toBeInstanceOf(ContractBuilder);
    expect(withExtensions).not.toBe(builder);
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
});
