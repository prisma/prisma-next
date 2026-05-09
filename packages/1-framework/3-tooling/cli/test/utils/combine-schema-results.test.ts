import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { combineSchemaResults } from '../../src/utils/combine-schema-results';

function makeResult(overrides: {
  spaceId: string;
  ok: boolean;
  summary: string;
  fail?: number;
}): VerifyDatabaseSchemaResult {
  const fail = overrides.fail ?? (overrides.ok ? 0 : 1);
  const result: VerifyDatabaseSchemaResult = {
    ok: overrides.ok,
    summary: overrides.summary,
    contract: { storageHash: `sha256:${overrides.spaceId}-storage` },
    target: { expected: 'postgres' },
    schema: {
      issues: [],
      root: {
        status: overrides.ok ? 'pass' : 'fail',
        kind: 'space',
        name: overrides.spaceId,
        contractPath: '',
        code: 'SPACE',
        message: overrides.summary,
        expected: undefined,
        actual: undefined,
        children: [],
      },
      counts: { pass: 0, warn: 0, fail, totalNodes: fail },
    },
    timings: { total: 0 },
  };
  if (!overrides.ok) {
    return { ...result, code: 'PN-RUN-3010' };
  }
  return result;
}

describe('combineSchemaResults', () => {
  it('preserves the per-family summary when every member passes', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      ['cipher', makeResult({ spaceId: 'cipher', ok: true, summary: 'Schema matches contract' })],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined.ok).toBe(true);
    expect(combined.summary).toBe('Database schema satisfies contract');
  });

  it('preserves the per-family failure summary when every member fails', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({
          spaceId: 'app',
          ok: false,
          summary: 'Database schema does not satisfy contract (1 failure)',
        }),
      ],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined.ok).toBe(false);
    expect(combined.summary).toBe('Database schema does not satisfy contract (1 failure)');
  });

  it('falls back to the failing member summary when the app passes but an extension fails', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: false,
          summary: 'Database schema does not satisfy contract (1 failure)',
          fail: 1,
        }),
      ],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined.ok).toBe(false);
    expect(combined.summary).toBe('Database schema does not satisfy contract (1 failure)');
    expect(combined.schema.counts.fail).toBe(1);
    expect(combined.code).toBe('PN-RUN-3010');
  });

  it('returns a non-`ok` envelope when any member fails, even when the app passes', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      ['app', makeResult({ spaceId: 'app', ok: true, summary: 'Schema matches contract' })],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: false,
          summary: 'Schema verification found 2 issue(s)',
          fail: 2,
        }),
      ],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', true);

    expect(combined.ok).toBe(false);
    expect(combined.summary).not.toContain('matches contract');
    expect(combined.schema.root.status).toBe('fail');
    expect(combined.schema.root.message).toBe('Aggregate schema mismatch');
    expect(combined.meta?.strict).toBe(true);
  });
});
