import { describe, expect, it } from 'vitest';
import { selectIncludeStrategy } from '../src/include-strategy';
import { getTestContract } from './helpers';

// The default test contract has `target: 'postgres'`, `targetFamily: 'sql'`,
// and capabilities populated under those two namespaces. The strategy
// selector reads only those namespaces, so override `capabilities`
// directly to drive each scenario.

describe('selectIncludeStrategy', () => {
  it('returns multiQuery when include capabilities are absent', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {},
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('multiQuery');
  });

  it('returns correlated when jsonAgg is enabled in the family namespace without lateral', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        sql: { jsonAgg: true },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });

  it('returns lateral when both flags are enabled in the same namespace', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        postgres: { jsonAgg: true, lateral: true },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('lateral');
  });

  it('returns lateral when flags are split across family and target namespaces', () => {
    // Real-world shape: SQL family declares `jsonAgg`; the postgres
    // target adds `lateral` on top.
    const contract = {
      ...getTestContract(),
      capabilities: {
        sql: { jsonAgg: true },
        postgres: { lateral: true },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('lateral');
  });

  it('ignores capability flags in unrelated namespaces', () => {
    // The default test contract's target/family are 'postgres' / 'sql'.
    // A `mongo: { lateral: true }` namespace must not enable lateral
    // on a postgres runtime — namespaces are scoped to the running
    // target/family.
    const contract = {
      ...getTestContract(),
      capabilities: {
        mongo: { jsonAgg: true, lateral: true },
        nonsense: { lateral: true },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('multiQuery');
  });

  it('treats non-boolean capability values as missing', () => {
    // The Contract type declares capability values as `boolean`. Anything
    // else (string, object, undefined) is treated as not present.
    const contract = {
      ...getTestContract(),
      capabilities: {
        sql: { jsonAgg: 'yes' as unknown as boolean, lateral: true },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('multiQuery');
  });

  it('treats explicit `false` as not enabled', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        sql: { jsonAgg: true, lateral: false },
      },
    } as unknown as ReturnType<typeof getTestContract>;

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });
});
