import { describe, expect, it, vi } from 'vitest';
import {
  migrationGraphShowsLegend,
  validateMigrationGraphLegendOptions,
} from '../../src/commands/migration-graph';
import { renderMigrationGraphLegend } from '../../src/utils/formatters/migration-graph-tree-render';
import type { GlobalFlags } from '../../src/utils/global-flags';
import { createTerminalUI } from '../../src/utils/terminal-ui';

const PRETTY: GlobalFlags = { format: 'pretty', explicitFormat: false };
const JSON_FLAGS: GlobalFlags = { format: 'json', explicitFormat: false, json: true };

describe('migrationGraphShowsLegend', () => {
  it('shows the legend for the pretty tree path', () => {
    expect(migrationGraphShowsLegend({ legend: true }, PRETTY)).toBe(true);
  });

  it('suppresses the legend under --quiet', () => {
    expect(migrationGraphShowsLegend({ legend: true }, { ...PRETTY, quiet: true })).toBe(false);
  });

  it('stays hidden without --legend', () => {
    expect(migrationGraphShowsLegend({}, PRETTY)).toBe(false);
  });
});

describe('validateMigrationGraphLegendOptions', () => {
  it('rejects --legend with --json', () => {
    const result = validateMigrationGraphLegendOptions({ legend: true }, JSON_FLAGS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('--legend');
      expect(result.failure.why).toContain('--json');
    }
  });

  it('rejects --legend with --dot', () => {
    const result = validateMigrationGraphLegendOptions({ legend: true, dot: true }, PRETTY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain('--legend');
      expect(result.failure.why).toContain('--dot');
    }
  });

  it('accepts --legend on the pretty tree path', () => {
    expect(validateMigrationGraphLegendOptions({ legend: true }, PRETTY).ok).toBe(true);
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
    expect(stderrText).not.toContain('gutter lanes by column');
    expect(stderr.at(-1)).toBe('');
    expect(outputSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    outputSpy.mockRestore();
  });
});
