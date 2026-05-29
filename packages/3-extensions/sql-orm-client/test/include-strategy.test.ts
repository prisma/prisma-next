import { describe, expect, it } from 'vitest';
import { selectIncludeStrategy } from '../src/include-strategy';
import { getTestContract, withCapabilities } from './helpers';

// The default test contract has `target: 'postgres'`, `targetFamily: 'sql'`,
// and capabilities populated under those two namespaces. The strategy
// selector reads only those namespaces, so each test uses
// `withCapabilities(...)` to swap in the override the scenario needs.

describe('selectIncludeStrategy', () => {
  it('returns correlated when the lateral capability is absent', () => {
    // The read path is capability-gated to two single-query builders:
    // lateral (Postgres) and correlated subqueries (any other jsonAgg
    // target). Absent the `lateral` flag, the selector falls to
    // correlated. Targets that declare neither `lateral` nor `jsonAgg`
    // are unsupported on the read path (see selectIncludeStrategy docs).
    const contract = withCapabilities(getTestContract(), {});

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });

  it('returns correlated when jsonAgg is enabled in the family namespace without lateral', () => {
    const contract = withCapabilities(getTestContract(), {
      sql: { jsonAgg: true },
    });

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });

  it('returns lateral when both flags are enabled in the same namespace', () => {
    const contract = withCapabilities(getTestContract(), {
      postgres: { jsonAgg: true, lateral: true },
    });

    expect(selectIncludeStrategy(contract)).toBe('lateral');
  });

  it('returns lateral when flags are split across family and target namespaces', () => {
    // Real-world shape: SQL family declares `jsonAgg`; the postgres
    // target adds `lateral` on top.
    const contract = withCapabilities(getTestContract(), {
      sql: { jsonAgg: true },
      postgres: { lateral: true },
    });

    expect(selectIncludeStrategy(contract)).toBe('lateral');
  });

  it('ignores capability flags in unrelated namespaces', () => {
    // The default test contract's target/family are 'postgres' / 'sql'.
    // A `mongo: { lateral: true }` namespace must not enable lateral
    // on a postgres runtime — namespaces are scoped to the running
    // target/family. Without lateral in scope, the selector falls to
    // correlated.
    const contract = withCapabilities(getTestContract(), {
      mongo: { jsonAgg: true, lateral: true },
      nonsense: { lateral: true },
    });

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });

  it('treats a non-boolean lateral value as missing', () => {
    // The Contract type declares capability values as `boolean`. Anything
    // else (string, object, undefined) is treated as not present, so a
    // bogus `lateral` value falls through to correlated. The cast on
    // `'yes'` is deliberate — we're feeding an invalid value through a
    // valid-typed contract to exercise the runtime check.
    const contract = withCapabilities(getTestContract(), {
      sql: { jsonAgg: true },
      postgres: { lateral: 'yes' as unknown as boolean },
    });

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });

  it('treats explicit `false` as not enabled', () => {
    const contract = withCapabilities(getTestContract(), {
      sql: { jsonAgg: true, lateral: false },
    });

    expect(selectIncludeStrategy(contract)).toBe('correlated');
  });
});
