import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { INIT_EXIT_OK } from '../../../packages/1-framework/3-tooling/cli/src/commands/init/exit-codes';
import { runInit } from '../../../packages/1-framework/3-tooling/cli/src/commands/init/init';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');

const NONINTERACTIVE_FLAGS = {
  json: false,
  quiet: true,
  verbose: 0,
  color: false,
  interactive: false,
  yes: true,
} as const;

interface ParsedSkillMetadata {
  readonly name: string;
  readonly internal: boolean;
}

describe('init skill distribution (offline integration)', () => {
  const testDirs = new Set<string>();

  afterEach(() => {
    for (const dir of testDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    testDirs.clear();
  });

  it('installs only user-facing skills by default', { timeout: 15_000 }, async () => {
    const testDir = createIntegrationTestDir();
    testDirs.add(testDir);
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '', 'utf8');

    const { fakeBinDir, logPath } = createFakePnpmHarness(testDir);

    const previousPath = process.env['PATH'];
    const previousRef = process.env['PRISMA_NEXT_SKILLS_REF'];
    const previousLog = process.env['TEST_FAKE_PNPM_LOG'];
    const previousInternal = process.env['INSTALL_INTERNAL_SKILLS'];

    process.env['PATH'] = `${fakeBinDir}:${previousPath ?? ''}`;
    process.env['PRISMA_NEXT_SKILLS_REF'] = pathToFileURL(WORKSPACE_ROOT).href;
    process.env['TEST_FAKE_PNPM_LOG'] = logPath;
    delete process.env['INSTALL_INTERNAL_SKILLS'];

    try {
      const exitCode = await runInit(testDir, {
        options: { target: 'postgres', authoring: 'psl', install: true },
        flags: NONINTERACTIVE_FLAGS,
        canPrompt: false,
      });

      expect(exitCode).toBe(INIT_EXIT_OK);
      expect(readLoggedCommands(logPath)).toContain(
        `dlx skills add ${pathToFileURL(WORKSPACE_ROOT).href} --all`,
      );
      expect(readInstalledSkillDirs(testDir)).toEqual(readUserFacingSkillNames());
    } finally {
      restoreEnvVar('PATH', previousPath);
      restoreEnvVar('PRISMA_NEXT_SKILLS_REF', previousRef);
      restoreEnvVar('TEST_FAKE_PNPM_LOG', previousLog);
      restoreEnvVar('INSTALL_INTERNAL_SKILLS', previousInternal);
    }
  });

  it('installs user-facing and contributor skills when internal opt-in is set', {
    timeout: 15_000,
  }, async () => {
    const testDir = createIntegrationTestDir();
    testDirs.add(testDir);
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '', 'utf8');

    const { fakeBinDir, logPath } = createFakePnpmHarness(testDir);

    const previousPath = process.env['PATH'];
    const previousRef = process.env['PRISMA_NEXT_SKILLS_REF'];
    const previousLog = process.env['TEST_FAKE_PNPM_LOG'];
    const previousInternal = process.env['INSTALL_INTERNAL_SKILLS'];

    process.env['PATH'] = `${fakeBinDir}:${previousPath ?? ''}`;
    process.env['PRISMA_NEXT_SKILLS_REF'] = pathToFileURL(WORKSPACE_ROOT).href;
    process.env['TEST_FAKE_PNPM_LOG'] = logPath;
    process.env['INSTALL_INTERNAL_SKILLS'] = '1';

    try {
      const exitCode = await runInit(testDir, {
        options: { target: 'postgres', authoring: 'psl', install: true },
        flags: NONINTERACTIVE_FLAGS,
        canPrompt: false,
      });

      expect(exitCode).toBe(INIT_EXIT_OK);
      expect(readLoggedCommands(logPath)).toContain(
        `dlx skills add ${pathToFileURL(WORKSPACE_ROOT).href} --all`,
      );
      expect(readInstalledSkillDirs(testDir)).toEqual(readAllSkillNames());
    } finally {
      restoreEnvVar('PATH', previousPath);
      restoreEnvVar('PRISMA_NEXT_SKILLS_REF', previousRef);
      restoreEnvVar('TEST_FAKE_PNPM_LOG', previousLog);
      restoreEnvVar('INSTALL_INTERNAL_SKILLS', previousInternal);
    }
  });
});

function createFakePnpmHarness(testDir: string): {
  readonly fakeBinDir: string;
  readonly logPath: string;
} {
  const fakeBinDir = join(testDir, '.fake-bin');
  const logPath = join(testDir, '.fake-pnpm.log');
  mkdirSync(fakeBinDir, { recursive: true });
  writeFileSync(
    join(fakeBinDir, 'pnpm'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const cwd = process.cwd();
const logPath = process.env.TEST_FAKE_PNPM_LOG;
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({ cwd, args }) + '\\n', 'utf8');
}

if (args[0] === 'add' || args[0] === 'install' || args[0] === 'prisma-next') {
  process.exit(0);
}

if (args[0] === 'dlx' && args[1] === 'skills' && args[2] === 'add') {
  const source = args[3];
  if (typeof source !== 'string' || source.length === 0) {
    process.stderr.write('fake pnpm: missing skills source\\n');
    process.exit(1);
  }
  if (!source.startsWith('file:')) {
    process.stderr.write('fake pnpm: expected file: source, got ' + source + '\\n');
    process.exit(1);
  }

  const includeInternal =
    process.env.INSTALL_INTERNAL_SKILLS === '1' || process.env.INSTALL_INTERNAL_SKILLS === 'true';
  const sourceRoot = fileURLToPath(source);
  const targetRoot = path.join(cwd, '.agents', 'skills');
  fs.mkdirSync(targetRoot, { recursive: true });

  const candidateRoots = [
    path.join(sourceRoot, 'skills'),
    path.join(sourceRoot, '.agents', 'skills'),
  ];

  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(root, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const metadata = readFrontmatter(skillFile);
      if (metadata === null) continue;
      if (metadata.internal && !includeInternal) continue;
      const installName = sanitizeName(metadata.name || entry.name);
      const destination = path.join(targetRoot, installName);
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(skillDir, destination, { recursive: true });
    }
  }

  process.exit(0);
}

process.exit(0);

function readFrontmatter(skillPath) {
  const source = fs.readFileSync(skillPath, 'utf8');
  if (!source.startsWith('---\\n')) return null;
  const end = source.indexOf('\\n---\\n', 4);
  if (end === -1) return null;
  const frontmatter = source.slice(4, end);
  const lines = frontmatter.split('\\n');
  let name = '';
  let internal = false;
  let inMetadata = false;
  for (const line of lines) {
    if (line.startsWith('name:')) {
      name = line.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (line.trim() === 'metadata:') {
      inMetadata = true;
      continue;
    }
    if (!inMetadata) continue;
    if (line.startsWith('  ')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('internal:')) {
        const value = trimmed.slice('internal:'.length).trim().replace(/^['"]|['"]$/g, '');
        internal = value === 'true';
      }
      continue;
    }
    if (line.trim() !== '') {
      inMetadata = false;
    }
  }
  return { name, internal };
}

function sanitizeName(name) {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return sanitized.substring(0, 255) || 'unnamed-skill';
}
`,
    'utf8',
  );
  chmodSync(join(fakeBinDir, 'pnpm'), 0o755);
  return { fakeBinDir, logPath };
}

function readLoggedCommands(logPath: string): readonly string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly args: readonly string[] })
    .map((entry) => entry.args.join(' '));
}

function readInstalledSkillDirs(testDir: string): readonly string[] {
  const root = join(testDir, '.agents', 'skills');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readUserFacingSkillNames(): readonly string[] {
  return readSkillNamesFrom(join(WORKSPACE_ROOT, 'skills'));
}

function readAllSkillNames(): readonly string[] {
  const publicNames = readSkillNamesFrom(join(WORKSPACE_ROOT, 'skills'));
  const contributorNames = readSkillNamesFrom(join(WORKSPACE_ROOT, '.agents', 'skills'), true);
  return Array.from(new Set([...publicNames, ...contributorNames])).sort();
}

function readSkillNamesFrom(root: string, includeInternal = false): readonly string[] {
  if (!existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(root, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const metadata = parseSkillMetadata(skillFile);
    if (metadata === null) continue;
    if (metadata.internal && !includeInternal) continue;
    names.push(sanitizeSkillDirName(metadata.name || entry.name));
  }
  return Array.from(new Set(names)).sort();
}

function parseSkillMetadata(skillFile: string): ParsedSkillMetadata | null {
  const source = readFileSync(skillFile, 'utf8');
  if (!source.startsWith('---\n')) return null;
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return null;

  const lines = source.slice(4, end).split('\n');
  let name = '';
  let internal = false;
  let inMetadata = false;

  for (const line of lines) {
    if (line.startsWith('name:')) {
      name = line
        .slice('name:'.length)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (line.trim() === 'metadata:') {
      inMetadata = true;
      continue;
    }
    if (!inMetadata) continue;
    if (line.startsWith('  ')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('internal:')) {
        const value = trimmed
          .slice('internal:'.length)
          .trim()
          .replace(/^['"]|['"]$/g, '');
        internal = value === 'true';
      }
      continue;
    }
    if (line.trim() !== '') {
      inMetadata = false;
    }
  }

  return { name, internal };
}

function sanitizeSkillDirName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return sanitized.substring(0, 255) || 'unnamed-skill';
}

function restoreEnvVar(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
