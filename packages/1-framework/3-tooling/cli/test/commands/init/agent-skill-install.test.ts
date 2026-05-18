import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SKILL_BASE,
  DEFAULT_AGENT_SKILL_SOURCES,
  formatSkillInstallCommand,
  formatSkillSourceUrl,
} from '../../../src/commands/init/agent-skill-install';
import type { PackageManager } from '../../../src/commands/init/detect-package-manager';

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

const usageSource = DEFAULT_AGENT_SKILL_SOURCES.find((s) => s.subpath === 'skills');
const upgradeSource = DEFAULT_AGENT_SKILL_SOURCES.find((s) => s.subpath === 'skills/upgrade');
const extAuthorSource = DEFAULT_AGENT_SKILL_SOURCES.find(
  (s) => s.subpath === 'skills/extension-author',
);

if (!usageSource || !upgradeSource || !extAuthorSource) {
  throw new Error('DEFAULT_AGENT_SKILL_SOURCES is missing expected entries');
}

describe('formatSkillSourceUrl', () => {
  it('formats the usage cluster URL without a git ref', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(usageSource)).toBe(`${DEFAULT_AGENT_SKILL_BASE}/skills`);
    });
  });

  it('formats the upgrade cluster URL', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(upgradeSource)).toBe(
        `${DEFAULT_AGENT_SKILL_BASE}/skills/upgrade`,
      );
    });
  });

  it('formats the extension-author cluster URL', () => {
    withCleanEnv(() => {
      expect(formatSkillSourceUrl(extAuthorSource)).toBe(
        `${DEFAULT_AGENT_SKILL_BASE}/skills/extension-author`,
      );
    });
  });

  it('substitutes the base from PRISMA_NEXT_SKILLS_BASE when set', () => {
    withCleanEnv(() => {
      process.env['PRISMA_NEXT_SKILLS_BASE'] = 'myuser/prisma-next';
      expect(formatSkillSourceUrl(usageSource)).toBe('myuser/prisma-next/skills');
    });
  });

  it('supports an absolute local-path base', () => {
    withCleanEnv(() => {
      process.env['PRISMA_NEXT_SKILLS_BASE'] = '/tmp/clone';
      expect(formatSkillSourceUrl(usageSource)).toBe('/tmp/clone/skills');
      expect(formatSkillSourceUrl(upgradeSource)).toBe('/tmp/clone/skills/upgrade');
    });
  });
});

describe('formatSkillInstallCommand', () => {
  it.each([
    ['npm', `npx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills --all`],
    ['pnpm', `pnpm dlx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills --all`],
    ['yarn', `yarn dlx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills --all`],
    ['bun', `bunx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills --all`],
    ['deno', `deno run -A npm:skills add ${DEFAULT_AGENT_SKILL_BASE}/skills --all`],
  ] satisfies ReadonlyArray<
    readonly [PackageManager, string]
  >)('formats %s command with the usage source', (pm, expected) => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand(pm, usageSource)).toBe(expected);
    });
  });

  it('formats the pnpm command for the upgrade source', () => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand('pnpm', upgradeSource)).toBe(
        `pnpm dlx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills/upgrade --all`,
      );
    });
  });

  it('formats the pnpm command for the extension-author source', () => {
    withCleanEnv(() => {
      expect(formatSkillInstallCommand('pnpm', extAuthorSource)).toBe(
        `pnpm dlx skills add ${DEFAULT_AGENT_SKILL_BASE}/skills/extension-author --all`,
      );
    });
  });
});
