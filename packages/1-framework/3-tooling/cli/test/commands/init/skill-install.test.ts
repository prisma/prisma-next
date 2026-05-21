import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { version as cliVersion } from '../../../package.json' with { type: 'json' };
import type { PackageManager } from '../../../src/commands/init/detect-package-manager';
import {
  DEFAULT_SKILL_BASE,
  DEFAULT_SKILL_SOURCES,
  formatClaudeSkillInstallCommand,
  formatSkillInstallCommand,
  formatSkillSourceUrl,
  formatWindsurfSkillInstallCommand,
  isWindsurfDetected,
  resolveProjectSkillInstallCommands,
} from '../../../src/commands/init/skill-install';

const PRESERVED_ENV = ['PRISMA_NEXT_SKILLS_BASE'] as const;

function withCleanEnv<T>(fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of PRESERVED_ENV) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of PRESERVED_ENV) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const usageSource = DEFAULT_SKILL_SOURCES.find((s) => s.subpath === 'skills');
const upgradeSource = DEFAULT_SKILL_SOURCES.find((s) => s.subpath === 'skills/upgrade');
const extAuthorSource = DEFAULT_SKILL_SOURCES.find((s) => s.subpath === 'skills/extension-author');

if (!usageSource || !upgradeSource || !extAuthorSource) {
  throw new Error('DEFAULT_SKILL_SOURCES is missing expected entries');
}

describe('formatSkillSourceUrl', () => {
  it('pins the usage cluster to the CLI version', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(usageSource)).toBe(`${DEFAULT_SKILL_BASE}/skills#v${cliVersion}`);
    });
  });

  it('leaves the upgrade cluster unpinned (always tracks main)', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(upgradeSource)).toBe(`${DEFAULT_SKILL_BASE}/skills/upgrade`);
    });
  });

  it('leaves the extension-author cluster unpinned (always tracks main)', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(extAuthorSource)).toBe(
        `${DEFAULT_SKILL_BASE}/skills/extension-author`,
      );
    });
  });

  it('substitutes the base from PRISMA_NEXT_SKILLS_BASE when set', () => {
    withCleanEnv(() => {
      process.env['PRISMA_NEXT_SKILLS_BASE'] = 'myuser/prisma-next';
      expect(formatSkillSourceUrl(usageSource)).toBe(`myuser/prisma-next/skills#v${cliVersion}`);
    });
  });

  it('drops the #ref fragment when the base is an absolute local path', () => {
    withCleanEnv(() => {
      process.env['PRISMA_NEXT_SKILLS_BASE'] = '/tmp/clone';
      expect(formatSkillSourceUrl(usageSource)).toBe('/tmp/clone/skills');
      expect(formatSkillSourceUrl(upgradeSource)).toBe('/tmp/clone/skills/upgrade');
    });
  });
});

describe('formatSkillInstallCommand', () => {
  it.each([
    ['npm', `npx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --all`],
    ['pnpm', `pnpm dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --all`],
    ['yarn', `yarn dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --all`],
    ['bun', `bunx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --all`],
    ['deno', `deno run -A npm:skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --all`],
  ] satisfies ReadonlyArray<
    readonly [PackageManager, string]
  >)('formats %s command with the version-pinned usage source', (pm, expected) => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand(pm, usageSource)).toBe(expected);
    });
  });

  it('pnpm command for the upgrade source omits the #ref fragment', () => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand('pnpm', upgradeSource)).toBe(
        `pnpm dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills/upgrade --all`,
      );
    });
  });

  it('pnpm command for the extension-author source omits the #ref fragment', () => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand('pnpm', extAuthorSource)).toBe(
        `pnpm dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills/extension-author --all`,
      );
    });
  });
});

describe('formatClaudeSkillInstallCommand', () => {
  it.each([
    [
      'npm',
      `npx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent claude-code --skill '*' -y`,
    ],
    [
      'pnpm',
      `pnpm dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent claude-code --skill '*' -y`,
    ],
    [
      'yarn',
      `yarn dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent claude-code --skill '*' -y`,
    ],
    [
      'bun',
      `bunx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent claude-code --skill '*' -y`,
    ],
    [
      'deno',
      `deno run -A npm:skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent claude-code --skill '*' -y`,
    ],
  ] satisfies ReadonlyArray<
    readonly [PackageManager, string]
  >)('formats %s command with the usage source', (pm, expected) => {
    withCleanEnv(() => {
      expect(formatClaudeSkillInstallCommand(pm, usageSource)).toBe(expected);
    });
  });
});

describe('formatWindsurfSkillInstallCommand', () => {
  it.each([
    [
      'npm',
      `npx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent windsurf --skill '*' -y`,
    ],
    [
      'pnpm',
      `pnpm dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent windsurf --skill '*' -y`,
    ],
    [
      'yarn',
      `yarn dlx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent windsurf --skill '*' -y`,
    ],
    [
      'bun',
      `bunx skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent windsurf --skill '*' -y`,
    ],
    [
      'deno',
      `deno run -A npm:skills@latest add ${DEFAULT_SKILL_BASE}/skills#v${cliVersion} --agent windsurf --skill '*' -y`,
    ],
  ] satisfies ReadonlyArray<
    readonly [PackageManager, string]
  >)('formats %s command with the usage source', (pm, expected) => {
    withCleanEnv(() => {
      expect(formatWindsurfSkillInstallCommand(pm, usageSource)).toBe(expected);
    });
  });
});

describe('isWindsurfDetected', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns true when the WINDSURF session marker is set', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-detect-'));
    expect(isWindsurfDetected({ baseDir: tmpDir, env: { WINDSURF: '1' } })).toBe(true);
  });

  it('returns true when the project already has a .windsurf directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-detect-'));
    mkdirSync(join(tmpDir, '.windsurf'));
    expect(isWindsurfDetected({ baseDir: tmpDir, env: {} })).toBe(true);
  });

  it('returns true when Windsurf is installed globally', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-detect-'));
    const fakeHome = mkdtempSync(join(tmpdir(), 'windsurf-home-'));
    mkdirSync(join(fakeHome, '.codeium', 'windsurf'), { recursive: true });
    expect(isWindsurfDetected({ baseDir: tmpDir, env: {}, homeDir: fakeHome })).toBe(true);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('returns false when no Windsurf markers are present', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-detect-'));
    const fakeHome = mkdtempSync(join(tmpdir(), 'windsurf-home-'));
    expect(isWindsurfDetected({ baseDir: tmpDir, env: {}, homeDir: fakeHome })).toBe(false);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('resolveProjectSkillInstallCommands', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('includes Windsurf installs when Windsurf is detected', () => {
    withCleanEnv(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-resolve-'));
      const commands = resolveProjectSkillInstallCommands('pnpm', {
        baseDir: tmpDir,
        env: { WINDSURF: '1' },
      });
      expect(commands).toHaveLength(DEFAULT_SKILL_SOURCES.length * 3);
      expect(commands.filter((c) => c.includes('--agent windsurf'))).toHaveLength(
        DEFAULT_SKILL_SOURCES.length,
      );
    });
  });

  it('omits Windsurf installs when Windsurf is absent', () => {
    withCleanEnv(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'windsurf-resolve-'));
      const fakeHome = mkdtempSync(join(tmpdir(), 'windsurf-home-'));
      const commands = resolveProjectSkillInstallCommands('pnpm', {
        baseDir: tmpDir,
        env: {},
        homeDir: fakeHome,
      });
      expect(commands).toHaveLength(DEFAULT_SKILL_SOURCES.length * 2);
      expect(commands.some((c) => c.includes('--agent windsurf'))).toBe(false);
      expect(commands.filter((c) => c.includes('--all'))).toHaveLength(
        DEFAULT_SKILL_SOURCES.length,
      );
      expect(commands.filter((c) => c.includes('--agent claude-code'))).toHaveLength(
        DEFAULT_SKILL_SOURCES.length,
      );
      rmSync(fakeHome, { recursive: true, force: true });
    });
  });
});
