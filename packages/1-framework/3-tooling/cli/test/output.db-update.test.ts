import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { parseGlobalFlags } from '../src/utils/global-flags';
import {
  formatMigrationApplyOutput,
  formatMigrationJson,
  formatMigrationPlanOutput,
  type MigrationCommandResult,
} from '../src/utils/output';

function createPlanResult(overrides?: Partial<MigrationCommandResult>): MigrationCommandResult {
  return {
    ok: true,
    mode: 'plan',
    plan: {
      targetId: 'postgres',
      destination: {
        storageHash: 'sha256:dest-hash',
        profileHash: 'sha256:dest-profile',
      },
      operations: [
        {
          id: 'column.user.nickname',
          label: 'Add column nickname on user',
          operationClass: 'additive',
        },
        {
          id: 'dropColumn.post.legacy',
          label: 'Drop column legacy on post',
          operationClass: 'destructive',
        },
      ],
    },
    origin: {
      storageHash: 'sha256:origin-hash',
      profileHash: 'sha256:origin-profile',
    },
    summary: 'Planned 2 operation(s)',
    timings: { total: 42 },
    ...overrides,
  };
}

function createApplyResult(overrides?: Partial<MigrationCommandResult>): MigrationCommandResult {
  return {
    ok: true,
    mode: 'apply',
    plan: {
      targetId: 'postgres',
      destination: {
        storageHash: 'sha256:dest-hash',
      },
      operations: [
        {
          id: 'column.user.nickname',
          label: 'Add column nickname on user',
          operationClass: 'additive',
        },
      ],
    },
    origin: {
      storageHash: 'sha256:origin-hash',
    },
    execution: {
      operationsPlanned: 1,
      operationsExecuted: 1,
    },
    marker: {
      storageHash: 'sha256:dest-hash',
    },
    summary: 'Applied 1 operation(s), signature updated',
    timings: { total: 100 },
    ...overrides,
  };
}

describe('formatMigrationPlanOutput', () => {
  it('shows operation count and tree', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Planned 2 operation(s)');
    expect(stripped).toContain('Add column nickname on user');
    expect(stripped).toContain('Drop column legacy on post');
    expect(stripped).toContain('[additive]');
    expect(stripped).toContain('[destructive]');
  });

  it('shows destination hash', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('sha256:dest-hash');
  });

  it('shows dry run note', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('dry run');
    expect(stripped).toContain('Run without --plan');
  });

  it('shows tree characters', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('├');
    expect(stripped).toContain('└');
  });

  it('handles zero operations', () => {
    const result = createPlanResult({
      plan: { targetId: 'postgres', destination: { storageHash: 'sha256:same' }, operations: [] },
      summary: 'Planned 0 operation(s)',
    });
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Planned 0 operation(s)');
    expect(stripped).not.toContain('├');
  });

  it('returns empty string in quiet mode', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationPlanOutput(result, flags);

    expect(output).toBe('');
  });

  it('includes timings in verbose mode', () => {
    const result = createPlanResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });
    const output = formatMigrationPlanOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Total time: 42ms');
  });
});

describe('formatMigrationApplyOutput', () => {
  it('shows executed operation count', () => {
    const result = createApplyResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Applied 1 operation(s)');
  });

  it('shows marker hash', () => {
    const result = createApplyResult();
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Signature: sha256:dest-hash');
  });

  it('shows profile hash when present', () => {
    const result = createApplyResult({
      marker: {
        storageHash: 'sha256:dest-hash',
        profileHash: 'sha256:dest-profile',
      },
    });
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Profile hash: sha256:dest-profile');
  });

  it('returns empty string in quiet mode', () => {
    const result = createApplyResult();
    const flags = parseGlobalFlags({ quiet: true });
    const output = formatMigrationApplyOutput(result, flags);

    expect(output).toBe('');
  });

  it('includes timings in verbose mode', () => {
    const result = createApplyResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });
    const output = formatMigrationApplyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Total time: 100ms');
  });

  it('shows no-op message when zero operations executed', () => {
    const result = createApplyResult({
      plan: {
        targetId: 'postgres',
        destination: { storageHash: 'sha256:same' },
        operations: [],
      },
      execution: { operationsPlanned: 0, operationsExecuted: 0 },
      marker: { storageHash: 'sha256:same' },
      summary: 'Database already matches contract, signature updated',
    });
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatMigrationApplyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Database already matches contract');
    expect(stripped).not.toContain('Applied 0');
  });
});

describe('formatMigrationJson', () => {
  it('returns valid parseable JSON', () => {
    const result = createPlanResult();
    const output = formatMigrationJson(result);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('includes all plan fields in JSON output', () => {
    const result = createPlanResult();
    const output = formatMigrationJson(result);
    const parsed = JSON.parse(output) as MigrationCommandResult;

    expect(parsed).toMatchObject({
      ok: true,
      mode: 'plan',
      plan: {
        targetId: 'postgres',
        destination: { storageHash: 'sha256:dest-hash' },
        operations: expect.arrayContaining([
          expect.objectContaining({ id: 'column.user.nickname', operationClass: 'additive' }),
        ]),
      },
      summary: 'Planned 2 operation(s)',
    });
  });

  it('includes origin in JSON output', () => {
    const result = createPlanResult();
    const output = formatMigrationJson(result);
    const parsed = JSON.parse(output) as MigrationCommandResult;

    expect(parsed).toMatchObject({
      origin: {
        storageHash: 'sha256:origin-hash',
        profileHash: 'sha256:origin-profile',
      },
    });
  });

  it('includes execution and marker fields in apply JSON output', () => {
    const result = createApplyResult();
    const output = formatMigrationJson(result);
    const parsed = JSON.parse(output) as MigrationCommandResult;

    expect(parsed).toMatchObject({
      ok: true,
      mode: 'apply',
      execution: { operationsPlanned: 1, operationsExecuted: 1 },
      marker: { storageHash: 'sha256:dest-hash' },
    });
  });

  it('uses 2-space indentation', () => {
    const result = createPlanResult();
    const output = formatMigrationJson(result);
    const lines = output.split('\n');

    expect(lines[1]).toMatch(/^ {2}"/);
  });
});
