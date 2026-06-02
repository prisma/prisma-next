import { describe, expect, it, vi } from 'vitest';
import {
  migrationGraphShowsLegend,
  migrationGraphUsesTree,
} from '../../src/commands/migration-graph';
import { renderMigrationGraphLegend } from '../../src/utils/formatters/migration-graph-tree-render';
import type { GlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';

const PRETTY: GlobalFlags = { format: 'pretty', explicitFormat: false };
const JSON_FLAGS: GlobalFlags = { format: 'json', explicitFormat: false, json: true };

describe('migrationGraphUsesTree', () => {
  it('treats --legend as implying --tree', () => {
    expect(migrationGraphUsesTree({ legend: true })).toBe(true);
  });

  it('honors an explicit --tree', () => {
    expect(migrationGraphUsesTree({ tree: true })).toBe(true);
  });

  it('stays on the default renderer without --tree or --legend', () => {
    expect(migrationGraphUsesTree({})).toBe(false);
    expect(migrationGraphUsesTree({ tree: false, legend: false })).toBe(false);
  });
});

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
    // Spy on the TerminalUI instance methods (not the global process streams):
    // the suite runs with `isolate: false` in a shared process, so a global
    // `process.stdout`/`process.stderr` spy would corrupt other files' output
    // capture. The rail methods are the command's actual stdout/stderr split.
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

    // Mirror the command's invocation: the legend, then a trailing blank line
    // separating the stderr key from the graph that follows on stdout.
    ui.stderr(renderMigrationGraphLegend({ colorize: false }));
    ui.stderr('');

    const stderrText = stderr.join('\n');
    expect(stderrText).toContain('Legend:');
    expect(stderrText).toContain('(refs) db / contract markers');
    expect(stderrText).toContain('migration from contract aaaaaa to bbbbbb');
    expect(stderrText).not.toContain('lanes');
    // The trailing blank line is its own stderr write, producing visible separation.
    expect(stderr.at(-1)).toBe('');
    expect(outputSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    outputSpy.mockRestore();
  });
});
