#!/usr/bin/env node

/**
 * Composes the version + dist-tag the publish workflow will use.
 *
 * The base version comes from the root `package.json` (the
 * source-of-truth introduced by the package.json-versioning refactor).
 * This script is responsible only for the suffix and dist-tag
 * appropriate to the GitHub event:
 *
 * - `push`              → `<base>-dev.N`, dist-tag `dev`
 *                          (where N is the next available build number,
 *                          discovered by querying npm).
 * - `workflow_dispatch` → `<base>` (no suffix), dist-tag from
 *                          `INPUT_DIST_TAG` (defaults to `latest`).
 *
 * Outputs `version` and `tag` to `$GITHUB_OUTPUT` for downstream
 * workflow steps to consume.
 */

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCanonicalBase } from './determine-version-utils.ts';

const PACKAGE_NAME = process.argv[2] ?? '@prisma-next/contract';

interface VersionResult {
  version: string;
  tag: string;
}

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readRootVersion(): string {
  const pkgPath = path.join(rootDir, 'package.json');
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(
      `Root package.json (${pkgPath}) is missing a \`version\` field. ` +
        'The publish pipeline now reads the version directly from the workspace root; ' +
        'set it (e.g. `pnpm bump-minor`) before publishing.',
    );
  }
  return parsed.version;
}

function run(command: string): string | undefined {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

function getLatestDevVersion(): string | undefined {
  return run(`npm view "${PACKAGE_NAME}" dist-tags.dev`);
}

function determineDevVersion(baseVersion: string): VersionResult {
  const latestDevVersion = getLatestDevVersion();
  let buildNumber = 1;

  if (latestDevVersion) {
    const devPattern = /^(\d+\.\d+\.\d+)-dev\.(\d+)$/;
    const match = latestDevVersion.match(devPattern);

    if (match) {
      const [, devBase, build] = match;
      if (devBase === baseVersion) {
        buildNumber = Number.parseInt(build, 10) + 1;
      }
    }
  }

  return {
    version: `${baseVersion}-dev.${buildNumber}`,
    tag: 'dev',
  };
}

function writeGitHubOutput(result: VersionResult): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `version<<EOF\n${result.version}\nEOF\n`);
    appendFileSync(outputFile, `tag<<EOF\n${result.tag}\nEOF\n`);
  }
}

const eventName = process.env.GITHUB_EVENT_NAME;
const inputDistTag = process.env.INPUT_DIST_TAG;

const baseVersion = readRootVersion();
assertCanonicalBase(baseVersion);

console.log(`Event:                 ${eventName}`);
console.log(`Base version (root):   ${baseVersion}`);

let result: VersionResult;

switch (eventName) {
  case 'workflow_dispatch':
    result = { version: baseVersion, tag: inputDistTag ?? 'latest' };
    break;

  case 'push':
    result = determineDevVersion(baseVersion);
    break;

  default:
    throw new Error(`don't know how to handle event ${eventName}`);
}

console.log(`Resolved version:      ${result.version}`);
console.log(`Resolved dist-tag:     ${result.tag}`);
writeGitHubOutput(result);
