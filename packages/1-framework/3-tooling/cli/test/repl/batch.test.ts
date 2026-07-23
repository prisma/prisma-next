import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runBatchSession } from '../../src/repl/batch';
import type { ReplContext } from '../../src/repl/load-repl-context';
import { extractReplSchemaInfo } from '../../src/repl/schema-info';
import { replContractFixture } from './fixture';

function stubContext(): { context: ReplContext; executed: unknown[] } {
  const executed: unknown[] = [];
  const context: ReplContext = {
    db: {
      sql: {},
      orm: {},
      enums: {},
      raw: {},
      runtime: () => ({ execute: async () => [] }),
      close: async () => undefined,
    },
    schema: extractReplSchemaInfo(replContractFixture),
    targetId: 'postgres',
    dbUrlMasked: 'postgres://****@localhost/db',
    contractPath: '/tmp/contract.json',
    executePlan: async (plan: unknown) => {
      executed.push(plan);
      return [{ id: 1 }];
    },
    close: async () => undefined,
  };
  return { context, executed };
}

async function runBatch(
  lines: string,
  echo = false,
): Promise<{ output: string; failures: number }> {
  const { context } = stubContext();
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  input.end(lines);
  const { failures } = await runBatchSession({
    context,
    // PassThrough streams stand in for process streams in tests.
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    color: false,
    echo,
  });
  return { output: Buffer.concat(chunks).toString('utf8'), failures };
}

describe('runBatchSession', () => {
  it('evaluates lines in order and prints results', async () => {
    const { output, failures } = await runBatch('1 + 1\n2 * 3\n');
    expect(output).toContain('2');
    expect(output).toContain('6');
    expect(failures).toBe(0);
  });

  it('skips blank lines and // comments', async () => {
    const { output, failures } = await runBatch('\n// a comment\n40 + 2\n');
    expect(output.trim()).toBe('42');
    expect(failures).toBe(0);
  });

  it('echoes inputs when requested', async () => {
    const { output } = await runBatch('1 + 1\n', true);
    expect(output).toContain('› 1 + 1');
  });

  it('counts failing lines and keeps evaluating', async () => {
    const { output, failures } = await runBatch('nope.nope\n1 + 1\n');
    expect(failures).toBe(1);
    expect(output).toContain('nope is not defined');
    expect(output).toContain('2');
  });

  it('runs meta commands', async () => {
    const { output } = await runBatch('.tables\n');
    expect(output).toContain('user');
    expect(output).toContain('post');
  });

  it('does not emit clear-screen escapes in batch mode', async () => {
    const { output } = await runBatch('.clear\n1 + 1\n');
    expect(output).not.toContain('\x1b[2J');
    expect(output).toContain('2');
  });

  it('stops at .exit and reports failures so far', async () => {
    const { output, failures } = await runBatch('nope.nope\n.exit\n99\n');
    expect(failures).toBe(1);
    expect(output).not.toContain('99');
  });

  it('evaluates leading-dot expressions instead of swallowing them', async () => {
    const { output, failures } = await runBatch('.5 + 1\n');
    expect(output.trim()).toBe('1.5');
    expect(failures).toBe(0);
  });
});
