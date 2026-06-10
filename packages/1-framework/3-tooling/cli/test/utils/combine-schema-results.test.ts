import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { combineSchemaResults } from '../../src/utils/combine-schema-results';

function makeResult(overrides: {
  spaceId: string;
  ok: boolean;
  summary: string;
  fail?: number;
  extensionIssues?: readonly SchemaDiffIssue[];
}): VerifyDatabaseSchemaResult {
  const fail = overrides.fail ?? (overrides.ok ? 0 : 1);
  const result: VerifyDatabaseSchemaResult = {
    ok: overrides.ok,
    summary: overrides.summary,
    contract: { storageHash: `sha256:${overrides.spaceId}-storage` },
    target: { expected: 'postgres' },
    schema: {
      issues: [],
      extensionIssues: overrides.extensionIssues ?? [],
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

    expect(combined).toMatchObject({
      ok: true,
      summary: 'Database schema satisfies contract',
    });
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

    expect(combined).toMatchObject({
      ok: false,
      summary: 'Database schema does not satisfy contract (1 failure)',
    });
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

    expect(combined).toMatchObject({
      ok: false,
      summary: 'Database schema does not satisfy contract (1 failure)',
      schema: { counts: { fail: 1 } },
      code: 'PN-RUN-3010',
    });
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

  it('throws a wiring-bug error when the per-space map is empty', () => {
    const empty = new Map<string, VerifyDatabaseSchemaResult>();
    expect(() => combineSchemaResults(empty, 'app', false)).toThrow(/wiring bug/);
  });

  it('falls back to the first iterator value when the app id is absent from the per-space map', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      ['cipher', makeResult({ spaceId: 'cipher', ok: true, summary: 'Schema matches contract' })],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined).toMatchObject({
      ok: true,
      summary: 'Schema matches contract',
      contract: { storageHash: 'sha256:cipher-storage' },
    });
  });

  it('keeps the first failure summary when multiple members fail', () => {
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({ spaceId: 'app', ok: true, summary: 'Database schema satisfies contract' }),
      ],
      ['cipher', makeResult({ spaceId: 'cipher', ok: false, summary: 'cipher failure', fail: 1 })],
      [
        'pgvector',
        makeResult({ spaceId: 'pgvector', ok: false, summary: 'pgvector failure', fail: 1 }),
      ],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined).toMatchObject({
      ok: false,
      summary: 'cipher failure',
      schema: { counts: { fail: 2 } },
    });
  });

  it('uses the default `PN-RUN-3010` code when a failing app result carries no code', () => {
    const failingWithoutCode: VerifyDatabaseSchemaResult = {
      ...makeResult({
        spaceId: 'app',
        ok: false,
        summary: 'Database schema does not satisfy contract (1 failure)',
        fail: 1,
      }),
    };
    const stripped = { ...failingWithoutCode };
    delete stripped.code;
    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([['app', stripped]]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined).toMatchObject({
      ok: false,
      code: 'PN-RUN-3010',
    });
  });

  it('concatenates extensionIssues from all members into the combined result', () => {
    const appIssue: SchemaDiffIssue = {
      coordinate: {
        plane: 'storage',
        entityKind: 'rlsPolicy',
        namespaceId: 'public',
        entityName: 'policy_app_abc',
      },
      outcome: 'missing',
      message: "missing: rlsPolicy 'policy_app_abc' in namespace 'public'",
    };
    const extIssue: SchemaDiffIssue = {
      coordinate: {
        plane: 'storage',
        entityKind: 'rlsPolicy',
        namespaceId: 'public',
        entityName: 'policy_cipher_def',
      },
      outcome: 'extra',
      message: "extra: rlsPolicy 'policy_cipher_def' in namespace 'public'",
    };

    const perSpace = new Map<string, VerifyDatabaseSchemaResult>([
      [
        'app',
        makeResult({
          spaceId: 'app',
          ok: true,
          summary: 'Database schema satisfies contract',
          extensionIssues: [appIssue],
        }),
      ],
      [
        'cipher',
        makeResult({
          spaceId: 'cipher',
          ok: true,
          summary: 'Schema matches contract',
          extensionIssues: [extIssue],
        }),
      ],
    ]);

    const combined = combineSchemaResults(perSpace, 'app', false);

    expect(combined.schema.extensionIssues).toEqual([appIssue, extIssue]);
  });
});
