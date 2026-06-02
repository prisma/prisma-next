import { describe, expect, it, vi } from 'vitest';
import { migrationGraphShowsLegend } from '../../src/commands/migration-graph';
import { renderMigrationGraphLegend } from '../../src/utils/formatters/migration-graph-tree-render';
import type { GlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';

const PRETTY: GlobalFlags = { format: 'pretty', explicitFormat: false };
const JSON_FLAGS: GlobalFlags = { format: 'json', explicitFormat: false, json: true };

describe('migrationGraphShowsLegend', () => {
  it('shows the legend for the pretty tree path', () => {
    expect(migrationGraphShowsLegend({ legend: true }, PRETTY)).toBe(true);
  });

  it('suppresses the legend for --json, --dot, and --quiet', () => {
    expect(migrationGraphShowsLegend({ legend: true }, JSON_FLAGS)).toBe(false);
    expect(migrationGraphShowsLegend({ legend: true, dot: true }, PRETTY)).toBe(false);
    expect(migrationGraphShowsLegend({ legend: true }, { ...PRETTY, quiet: true })).toBe(false);
  });

  it('stays hidden without --legend', () => {
    expect(migrationGraphShowsLegend({}, PRETTY)).toBe(false);
  });
});

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
    expect(stderrText).toContain('(refs) db / contract markers');
    expect(stderrText).toContain('migration from contract aaaaaa to bbbbbb');
    expect(stderrText).not.toContain('lanes');
    expect(stderr.at(-1)).toBe('');
    expect(outputSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    outputSpy.mockRestore();
  });
});
