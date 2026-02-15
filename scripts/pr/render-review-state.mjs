#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertReviewStateV1 } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function getHelpText() {
  return [
    'Usage:',
    '  render-review-state.mjs --in <review-state.json> [--out <review-state.md>|-] [--help]',
    '',
    'Purpose:',
    '  Render deterministic Markdown (review-state.md) from review-state.json.',
    '',
    'Flags:',
    '  --in <path.json>       Input path to review-state.json.',
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
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (!arg.startsWith('--') || !knownFlags.has(arg)) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }

    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }

    const value = args[index];
    if (arg === '--in') {
      result.inPath = value;
    } else if (arg === '--out') {
      result.outPath = value;
    }
    index += 1;
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

function formatLines(startLine, endLine) {
  if (Number.isInteger(startLine) && Number.isInteger(endLine)) {
    return `${startLine}-${endLine}`;
  }
  if (Number.isInteger(startLine)) {
    return String(startLine);
  }
  if (Number.isInteger(endLine)) {
    return String(endLine);
  }
  return '';
}

export function renderReviewStateMarkdown(payload, { sourcePath }) {
  assertReviewStateV1(payload);

  const source = sourcePath ? escapeTableCell(sourcePath) : 'review-state.json';
  const lines = [];

  lines.push('# Review State');
  lines.push('');
  lines.push(`PR: ${escapeTableCell(payload.pr.url)}`);
  lines.push(`Source: \`${source}\``);
  lines.push(`FetchedAt: ${escapeTableCell(payload.fetchedAt)}`);
  lines.push(`SourceBranch: ${escapeTableCell(payload.sourceBranch)}`);
  lines.push('');
  lines.push(`Unresolved threads: ${payload.reviewThreads.length}`);
  lines.push(`Reviews with body: ${payload.reviews.length}`);
  lines.push(`Issue comments: ${payload.issueComments.length}`);
  lines.push('');

  lines.push('## Unresolved Review Threads');
  lines.push('');
  lines.push('| Node ID | Path | Lines | Outdated | Comments |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const thread of payload.reviewThreads) {
    lines.push(
      [
        escapeTableCell(thread.nodeId),
        escapeTableCell(thread.path),
        escapeTableCell(formatLines(thread.startLine, thread.endLine)),
        thread.isOutdated ? 'yes' : 'no',
        escapeTableCell(thread.comments.length),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    );
  }
  lines.push('');

  lines.push('## Reviews With Body');
  lines.push('');
  lines.push('| Node ID | Author | State | Submitted At | URL |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const review of payload.reviews) {
    lines.push(
      [
        escapeTableCell(review.nodeId),
        escapeTableCell(review.author.login),
        escapeTableCell(review.state),
        escapeTableCell(review.submittedAt),
        escapeTableCell(review.url),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    );
  }
  lines.push('');

  lines.push('## Issue Comments');
  lines.push('');
  lines.push('| Node ID | Author | Created At | URL |');
  lines.push('| --- | --- | --- | --- |');
  for (const comment of payload.issueComments) {
    lines.push(
      [
        escapeTableCell(comment.nodeId),
        escapeTableCell(comment.author.login),
        escapeTableCell(comment.createdAt),
        escapeTableCell(comment.url),
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
    return;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text, 'utf8');
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const payload = await readJson(args.inPath);
  const markdown = renderReviewStateMarkdown(payload, { sourcePath: args.inPath });
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

export { parseCliArgs };

