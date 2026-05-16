import { describe, expect, it } from 'vitest';
import { version as cliVersion } from '../../../package.json' with { type: 'json' };
import { formatSkillInstallCommand } from '../../../src/commands/init/agent-skill-install';
import type { PackageManager } from '../../../src/commands/init/detect-package-manager';

describe('formatSkillInstallCommand', () => {
  const source = `prisma/prisma-next#v${cliVersion}`;

  it.each([
    ['npm', `npx skills add ${source} --all`],
    ['pnpm', `pnpm dlx skills add ${source} --all`],
    ['yarn', `yarn dlx skills add ${source} --all`],
    ['bun', `bunx skills add ${source} --all`],
    ['deno', `deno run -A npm:skills add ${source} --all`],
  ] satisfies ReadonlyArray<
    readonly [PackageManager, string]
  >)('formats %s command with cli-version source', (pm, expected) => {
    const previous = process.env['PRISMA_NEXT_SKILLS_REF'];
    delete process.env['PRISMA_NEXT_SKILLS_REF'];
    try {
      expect(formatSkillInstallCommand(pm)).toBe(expected);
    } finally {
      if (previous === undefined) {
        delete process.env['PRISMA_NEXT_SKILLS_REF'];
      } else {
        process.env['PRISMA_NEXT_SKILLS_REF'] = previous;
      }
    }
  });

  it('uses PRISMA_NEXT_SKILLS_REF override when set', () => {
    const previous = process.env['PRISMA_NEXT_SKILLS_REF'];
    process.env['PRISMA_NEXT_SKILLS_REF'] = 'file:/tmp/prisma-next-skills';
    try {
      expect(formatSkillInstallCommand('pnpm')).toBe(
        'pnpm dlx skills add file:/tmp/prisma-next-skills --all',
      );
    } finally {
      if (previous === undefined) {
        delete process.env['PRISMA_NEXT_SKILLS_REF'];
      } else {
        process.env['PRISMA_NEXT_SKILLS_REF'] = previous;
      }
    }
  });
});
