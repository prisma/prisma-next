import { describe, expect, it } from 'vitest';
import { DropTableCall } from '../../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

const renderTypeScript = (
  calls: Parameters<typeof renderCallsToTypeScript>[0],
  meta: Parameters<typeof renderCallsToTypeScript>[1],
) => renderCallsToTypeScript(calls, meta);

describe('renderCallsToTypeScript (sqlite)', () => {
  it('emits contract-JSON imports + fields and Migration<Start, End> header (with-start)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: 'sha256:aaa',
      to: 'sha256:bbb',
    });

    expect(output).toContain(
      "import { Migration, MigrationCLI } from '@prisma-next/sqlite/migration';",
    );
    expect(output).toContain(
      'import endContract from \'./end-contract.json\' with { type: "json" };',
    );
    expect(output).toContain(
      'import startContract from \'./start-contract.json\' with { type: "json" };',
    );
    expect(output).toContain("import type { Contract as End } from './end-contract';");
    expect(output).toContain("import type { Contract as Start } from './start-contract';");
    expect(output).toContain('export default class M extends Migration<Start, End> {');
    expect(output).toContain('override readonly startContractJson = startContract;');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain('override get operations()');
    expect(output).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('does NOT emit a describe() method (the base derives it from the contract JSON)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: 'sha256:aaa',
      to: 'sha256:bbb',
    });

    expect(output).not.toContain('describe()');
    expect(output).not.toContain('sha256:aaa');
    expect(output).not.toContain('sha256:bbb');
  });

  it('renders the baseline shape for from: null (no start imports, Migration<never, End>)', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: null,
      to: 'sha256:bbb',
    });

    expect(output).toContain('export default class M extends Migration<never, End> {');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain(
      'import endContract from \'./end-contract.json\' with { type: "json" };',
    );
    expect(output).toContain("import type { Contract as End } from './end-contract';");
    expect(output).not.toContain('start-contract');
    expect(output).not.toContain('startContractJson');
    expect(output).not.toContain('describe()');
  });

  it('inlines the operation calls unchanged', () => {
    const output = renderTypeScript([new DropTableCall('stale')], {
      from: null,
      to: 'sha256:bbb',
    });
    expect(output).toContain('this.dropTable({ table: "stale" })');
  });
});
