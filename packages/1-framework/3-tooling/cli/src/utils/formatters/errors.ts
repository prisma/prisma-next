import { red } from 'colorette';

import type { CliErrorConflict, CliErrorEnvelope } from '../cli-errors';
import type { GlobalFlags } from '../global-flags';
import { createColorFormatter, formatDim, isVerbose } from './helpers';

/**
 * Formats error output for human-readable display.
 */
export function formatErrorOutput(error: CliErrorEnvelope, flags: GlobalFlags): string {
  const lines: string[] = [];

  const useColor = flags.color !== false;
  const formatRed = createColorFormatter(useColor, red);
  const formatDimText = (text: string) => formatDim(useColor, text);

  lines.push(`${formatRed('✖')} ${error.summary} (${error.code})`);

  if (error.why) {
    lines.push(`${formatDimText(`  Why: ${error.why}`)}`);
  }
  if (error.fix) {
    lines.push(`${formatDimText(`  Fix: ${error.fix}`)}`);
  }
  if (error.where?.path) {
    const whereLine = error.where.line
      ? `${error.where.path}:${error.where.line}`
      : error.where.path;
    lines.push(`${formatDimText(`  Where: ${whereLine}`)}`);
  }
  // Show conflicts list if present (always show a short list; show full list when verbose)
  if (error.meta?.['conflicts']) {
    const conflicts = error.meta['conflicts'] as readonly CliErrorConflict[];
    if (conflicts.length > 0) {
      const maxToShow = isVerbose(flags, 1) ? conflicts.length : Math.min(3, conflicts.length);
      const header = isVerbose(flags, 1)
        ? '  Conflicts:'
        : `  Conflicts (showing ${maxToShow} of ${conflicts.length}):`;
      lines.push(`${formatDimText(header)}`);
      for (const conflict of conflicts.slice(0, maxToShow)) {
        lines.push(`${formatDimText(`    - [${conflict.kind}] ${conflict.summary}`)}`);
      }
      if (!isVerbose(flags, 1) && conflicts.length > maxToShow) {
        lines.push(`${formatDimText('  Re-run with -v/--verbose to see all conflicts')}`);
      }
    }
  }
  // Show issues list if present (always show a short list; show full list when verbose)
  if (error.meta?.['issues']) {
    const issues = error.meta['issues'] as readonly { kind?: string; message?: string }[];
    if (issues.length > 0) {
      const maxToShow = isVerbose(flags, 1) ? issues.length : Math.min(3, issues.length);
      const header = isVerbose(flags, 1)
        ? '  Issues:'
        : `  Issues (showing ${maxToShow} of ${issues.length}):`;
      lines.push(`${formatDimText(header)}`);
      for (const issue of issues.slice(0, maxToShow)) {
        const kind = issue.kind ?? 'issue';
        const message = issue.message ?? '';
        lines.push(`${formatDimText(`    - [${kind}] ${message}`)}`);
      }
      if (!isVerbose(flags, 1) && issues.length > maxToShow) {
        lines.push(`${formatDimText('  Re-run with -v/--verbose to see all issues')}`);
      }
    }
  }
  if (error.docsUrl && isVerbose(flags, 1)) {
    lines.push(formatDimText(error.docsUrl));
  }
  if (isVerbose(flags, 2) && error.meta) {
    lines.push(`${formatDimText(`  Meta: ${JSON.stringify(error.meta, null, 2)}`)}`);
  }

  return lines.join('\n');
}

/**
 * Formats error output as JSON.
 */
export function formatErrorJson(error: CliErrorEnvelope): string {
  return JSON.stringify(error, null, 2);
}
