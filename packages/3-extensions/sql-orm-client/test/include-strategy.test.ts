import { describe, expect, it } from 'vitest';
import { selectIncludeStrategy } from '../src/include-strategy';
import { getTestContract } from './helpers';

describe('selectIncludeStrategy', () => {
  it('returns multiQuery when include capabilities are absent', () => {
    const contract = getTestContract();
    const strategy = selectIncludeStrategy(contract);

    expect(strategy).toBe('multiQuery');
  });

  it('returns correlated when jsonAgg is enabled without lateral', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        jsonAgg: {
          enabled: true,
        },
      },
    };

    const strategy = selectIncludeStrategy(contract);
    expect(strategy).toBe('correlated');
  });

  it('returns lateral when both lateral and jsonAgg are enabled', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        lateral: {
          enabled: true,
        },
        jsonAgg: {
          enabled: true,
        },
      },
    };

    const strategy = selectIncludeStrategy(contract);
    expect(strategy).toBe('lateral');
  });

  it('reads object capabilities via enabled flag', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        lateral: { enabled: true },
        jsonAgg: { enabled: false, fallback: true },
      },
    };

    const strategy = selectIncludeStrategy(contract);
    expect(strategy).toBe('lateral');
  });

  it('accepts top-level boolean capability flags', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        lateral: true,
        jsonAgg: true,
      },
    } as unknown as ReturnType<typeof getTestContract>;

    const strategy = selectIncludeStrategy(contract);
    expect(strategy).toBe('lateral');
  });

  it('ignores non-boolean, non-object capability values', () => {
    const contract = {
      ...getTestContract(),
      capabilities: {
        lateral: 'yes',
        jsonAgg: true,
      },
    } as unknown as ReturnType<typeof getTestContract>;

    const strategy = selectIncludeStrategy(contract);
    expect(strategy).toBe('correlated');
  });
});
