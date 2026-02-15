#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

const DEFAULT_REVIEWS_ROOT = 'agent-os/specs/review-framework/reviews';

function getHelpText() {
  return [
    'Usage:',
    '  review-iterate.mjs --pr <url> [--reviews-root <dir>] [--help]',
    '',
    'Purpose:',
    '  Run a thin deterministic review loop wrapper for one PR.',
    '',
    'Reads/Writes:',
    '  - Writes under: <reviews-root>/<owner>_<repo>_pr-<number>/',
    '  - Fetches canonical review-state.json',
    '  - Renders review-state.md (derived)',
    '  - Summarizes review-state to summary.txt (derived)',
    '  - Renders review-actions.md if review-actions.json exists',
    '  - Does not run apply-review-actions (use implement phase + re-fetch/re-triage loop)',
    '',
    'Flags:',
    '  --pr <url>             GitHub pull request URL.',
    '  --reviews-root <dir>   Root directory for review artifacts.',
    '  --help                 Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = {
    prUrl: null,
    reviewsRoot: DEFAULT_REVIEWS_ROOT,
    help: false,
  };

  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg !== '--pr' && arg !== '--reviews-root') {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    if (index + 1 >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }
    const value = args[index + 1];
    if (arg === '--pr') {
      result.prUrl = value;
    } else if (arg === '--reviews-root') {
      result.reviewsRoot = value;
    }
    index += 2;
  }

  if (!result.prUrl) {
    throw { code: EXIT_CLI, message: 'error: --pr is required' };
  }

  return result;
}

function parsePrUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return null;
  }
  const match = url
    .trim()
    .match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/)?(?:#.*)?$/i);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    number: Number.parseInt(match[3], 10),
  };
}

function deriveReviewDirectoryName(prUrl) {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    throw new TypeError('error: invalid --pr value');
  }
  return `${parsed.owner.toLowerCase()}_${parsed.repo.toLowerCase()}_pr-${parsed.number}`;
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    const stdout = (result.stdout ?? '').trim();
    const message = stderr || stdout || `error: failed running ${scriptPath}`;
    throw new Error(message);
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseCliArgs(process.argv);
  if (options.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  if (!parsePrUrl(options.prUrl)) {
    throw { code: EXIT_CLI, message: 'error: --pr must be a GitHub pull request URL' };
  }

  const directoryName = deriveReviewDirectoryName(options.prUrl);
  const reviewDir = resolve(options.reviewsRoot, directoryName);
  await mkdir(reviewDir, { recursive: true });

  const reviewStateJsonPath = resolve(reviewDir, 'review-state.json');
  const reviewStateMdPath = resolve(reviewDir, 'review-state.md');
  const reviewSummaryPath = resolve(reviewDir, 'summary.txt');
  const reviewActionsJsonPath = resolve(reviewDir, 'review-actions.json');
  const reviewActionsMdPath = resolve(reviewDir, 'review-actions.md');

  await mkdir(dirname(reviewStateJsonPath), { recursive: true });

  runNodeScript('scripts/pr/fetch-review-state.mjs', [
    '--pr',
    options.prUrl,
    '--out-json',
    reviewStateJsonPath,
  ]);
  runNodeScript('scripts/pr/render-review-state.mjs', [
    '--in',
    reviewStateJsonPath,
    '--out',
    reviewStateMdPath,
  ]);
  runNodeScript('scripts/pr/summarize-review-state.mjs', [
    '--in',
    reviewStateJsonPath,
    '--format',
    'text',
    '--out',
    reviewSummaryPath,
  ]);

  if (await fileExists(reviewActionsJsonPath)) {
    runNodeScript('scripts/pr/render-review-actions.mjs', [
      '--in',
      reviewActionsJsonPath,
      '--out',
      reviewActionsMdPath,
    ]);
  } else {
    process.stdout.write(
      `info: review-actions.json not found at ${reviewActionsJsonPath}; skipping actions render\n`,
    );
  }

  process.stdout.write(`${reviewDir}\n`);
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

export {
  DEFAULT_REVIEWS_ROOT,
  deriveReviewDirectoryName,
  parseCliArgs,
  parsePrUrl,
};
