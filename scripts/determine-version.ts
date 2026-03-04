#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { findNextPrBuildNumber } from './determine-version-utils';

const PACKAGE_NAME = process.argv[2] ?? '@prisma-next/contract';

interface VersionResult {
  version: string;
  tag: string;
}

function run(command: string): string | undefined {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}

function getLatestStableVersion(): string {
  return run(`npm view "${PACKAGE_NAME}" dist-tags.latest`) ?? '0.0.0';
}

function getLatestDevVersion(): string | undefined {
  return run(`npm view "${PACKAGE_NAME}" dist-tags.dev`);
}

function getPrVersions(): string[] {
  const json = run(`npm view "${PACKAGE_NAME}@pr" versions --json`);
  if (!json) return [];
  return JSON.parse(json);
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return { major, minor, patch };
}

function calculateNextStableVersion(latestStable: string): string {
  const { major, minor } = parseVersion(latestStable);
  return `${major}.${minor + 1}.0`;
}

function determinePrVersion(baseVersion: string, prNumber: string): VersionResult {
  const prVersions = getPrVersions();
  const buildNumber = findNextPrBuildNumber(prVersions, prNumber);

  return {
    version: `${baseVersion}-pr.${prNumber}.${buildNumber}`,
    tag: 'pr',
  };
}

function determineDevVersion(baseVersion: string): VersionResult {
  const latestDevVersion = getLatestDevVersion();
  let buildNumber = 1;

  if (latestDevVersion) {
    const devPattern = /^(\d+\.\d+\.\d+)-dev\.(\d+)$/;
    const match = latestDevVersion.match(devPattern);

    if (match) {
      const devBase = match[1];
      const lastBuild = Number.parseInt(match[2], 10);

      if (devBase === baseVersion) {
        buildNumber = lastBuild + 1;
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
    // Use heredoc syntax to safely write to GITHUB_OUTPUT (prevents injection)
    appendFileSync(outputFile, `version<<EOF\n${result.version}\nEOF\n`);
    appendFileSync(outputFile, `tag<<EOF\n${result.tag}\nEOF\n`);
  }
}

const eventName = process.env.GITHUB_EVENT_NAME;
const inputVersion = process.env.INPUT_VERSION;
const inputTag = process.env.INPUT_TAG;
const prNumber = process.env.PR_NUMBER;

console.log(`Event: ${eventName}`);

const latestStable = getLatestStableVersion();
console.log(`Latest stable version: ${latestStable}`);

const baseVersion = calculateNextStableVersion(latestStable);
console.log(`Base version for dev builds: ${baseVersion}`);

let result: VersionResult;

switch (eventName) {
  case 'workflow_dispatch':
    if (!inputVersion || !inputTag) {
      throw new Error('INPUT_VERSION and INPUT_TAG are required for workflow_dispatch');
    }
    result = { version: inputVersion, tag: inputTag };
    break;

  case 'pull_request':
    if (!prNumber) {
      throw new Error('PR_NUMBER is required for pull_request events');
    }
    result = determinePrVersion(baseVersion, prNumber);
    console.log(`PR version: ${result.version}`);
    break;

  case 'push':
    result = determineDevVersion(baseVersion);
    console.log(`Dev version: ${result.version}`);
    break;

  default:
    throw new Error(`don't know how to handle event ${eventName}`);
}

console.log(`\nOutput: version=${result.version}, tag=${result.tag}`);
writeGitHubOutput(result);
