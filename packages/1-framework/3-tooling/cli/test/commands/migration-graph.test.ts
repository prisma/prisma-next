import { describe, expect, it, vi } from 'vitest';
import { renderMigrationGraphLegend } from '../../src/utils/formatters/migration-graph-tree-render';
import type { GlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';

const PRETTY: GlobalFlags = { format: 'pretty', explicitFormat: false };

describe('migration graph legend stream split', () => {
  it('routes the legend through the stderr rail, never stdout', () => {
    const ui = createTerminalUI({
      ...PRETTY,
      explicitFormat: true,
      interactive: true,
      color: false,
    });
    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(ui, 'stderr').mockImplementation((message) => {
      stderr.push(message);
    });
    const outputSpy = vi.spyOn(ui, 'output').mockImplementation(() => {});

    ui.stderr(renderMigrationGraphLegend({ colorize: false }));
    ui.stderr('');

    const stderrText = stderr.join('\n');
    expect(stderrText).toContain('Legend:');
    expect(stderrText).toContain('applied');
    expect(stderrText).toContain('pending');
    expect(stderrText).toContain('<contract, db>');
    expect(stderrText).toContain('(prod, staging)');
    expect(stderrText).toContain('live markers (contract on disk, database state)');
    expect(stderrText).toContain('user-defined refs');
    expect(stderrText).toContain('migration from contract aaaaaa to bbbbbb');
    expect(stderrText).not.toContain('gutter lanes by column');
    expect(stderr.at(-1)).toBe('');
    expect(outputSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    outputSpy.mockRestore();
  });
});
