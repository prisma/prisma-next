#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertReviewActionsV1 } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function getHelpText() {
  return [
    'Usage:',
    '  render-review-actions.mjs --in <review-actions.json> [--out <review-actions.md>|-] [--help]',
    '',
    'Purpose:',
    '  Render deterministic Markdown (review-actions.md) from review-actions.json.',
    '',
    'Flags:',
    '  --in <path.json>       Input path to review-actions.json.',
    '  --out <path.md>|-      Markdown output path. Use "-" to write to stdout. Defaults to stdout.',
    '  --help                 Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { inPath: null, outPath: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }
  const knownFlags = new Set(['--in', '--out']);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    const flag = arg;
    if (!knownFlags.has(flag)) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${flag}"` };
    }
    i++;
    if (i >= args.length) {
      throw {
        code: EXIT_CLI,
        message: `error: ${flag} requires a value`,
      };
    }
    const value = args[i];
    i++;
    if (flag === '--in') {
      result.inPath = value;
    } else if (flag === '--out') {
      result.outPath = value;
    }
  }
  if (!result.inPath) {
    throw { code: EXIT_CLI, message: 'error: --in is required' };
  }
  if (result.inPath !== '-' && !result.inPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in file path must end with .json' };
  }
  if (result.outPath !== null && result.outPath !== '-' && !result.outPath.endsWith('.md')) {
    throw { code: EXIT_CLI, message: 'error: --out file path must end with .md' };
  }
  return result;
}

function escapeTableCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCodePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return '';
  return paths.map((p) => `\`${escapeTableCell(p)}\``).join(', ');
}

function computeStatus(actions) {
  const statuses = new Set((actions ?? []).map((a) => a?.status).filter(Boolean));
  if (statuses.has('in_progress')) return 'In progress';
  if (statuses.size === 0) return 'Triaged';
  if (statuses.size === 1 && statuses.has('done')) return 'Complete';
  if (statuses.has('pending')) return 'Triaged';
  return 'Triaged';
}

function formatTarget(target) {
  const kind = escapeTableCell(target?.kind);
  const nodeId = escapeTableCell(target?.nodeId);
  return `${kind} / ${nodeId}`;
}

export function renderReviewActionsMarkdown(payload, { sourcePath }) {
  assertReviewActionsV1(payload);

  const prUrl = payload?.pr?.url ?? '';
  const source = sourcePath ? escapeTableCell(sourcePath) : 'review-actions.json';
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  const willAddress = actions.filter((a) => a?.decision === 'will_address');

  const lines = [];
  lines.push('# Review Actions');
  lines.push('');
  lines.push(`PR: ${escapeTableCell(prUrl)}`);
  lines.push(`Source: \`${source}\``);
  lines.push('');
  lines.push(`Status: ${computeStatus(willAddress)}`);
  lines.push('');
  lines.push('Only items triaged as **WILL ADDRESS** are listed below.');
  lines.push('');
  lines.push('| Action ID | Target | Link | Action | Target files | Acceptance check | Status |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const action of willAddress) {
    const actionId = action?.actionId ?? '';
    const target = formatTarget(action?.target);
    const link = action?.target?.url ?? '';
    const summary = action?.summary ?? '';
    const targetFiles = formatCodePaths(action?.targetFiles);
    const acceptance = action?.acceptance ?? '';
    const status = action?.status ?? '';

    lines.push(
      [
        escapeTableCell(actionId),
        target,
        escapeTableCell(link),
        escapeTableCell(summary),
        escapeTableCell(targetFiles),
        escapeTableCell(acceptance),
        escapeTableCell(status),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    );
  }

  return `${lines.join('\n')}\n`;
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function writeOutput(outPath, text) {
  if (!outPath || outPath === '-') {
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${text.endsWith('\n') ? text : `${text}\n`}`, 'utf8');
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const payload = await readJson(args.inPath);
  const markdown = renderReviewActionsMarkdown(payload, { sourcePath: args.inPath });
  await writeOutput(args.outPath, markdown);
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}

