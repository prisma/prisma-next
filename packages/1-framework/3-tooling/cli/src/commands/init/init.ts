import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import * as clack from '@clack/prompts';
import { dirname, isAbsolute, join } from 'pathe';
import { TerminalUI } from '../../utils/terminal-ui';
import { detectPackageManager, formatRunCommand } from './detect-package-manager';
import { agentSkillMd } from './templates/agent-skill';
import {
  type AuthoringId,
  configFile,
  dbFile,
  defaultSchemaPath,
  starterSchema,
  type TargetId,
  targetPackageName,
} from './templates/code-templates';
import { quickReferenceMd } from './templates/quick-reference';
import { defaultTsConfig, mergeTsConfig } from './templates/tsconfig';

export interface InitOptions {
  readonly noInstall?: boolean;
}

interface FileEntry {
  readonly path: string;
  readonly content: string;
}

export async function runInit(baseDir: string, options: InitOptions): Promise<void> {
  const ui = new TerminalUI();

  clack.intro('prisma-next init', { output: process.stderr });

  if (existsSync(join(baseDir, 'prisma-next.config.ts'))) {
    const reinit = await clack.confirm({
      message:
        'This project is already initialized. Re-initialize? This will overwrite all generated files.',
      initialValue: false,
      output: process.stderr,
    });
    if (clack.isCancel(reinit) || !reinit) {
      clack.cancel('Init cancelled.', { output: process.stderr });
      process.exit(0);
    }
  }

  const targetResult = await clack.select({
    message: 'What database are you using?',
    options: [
      { value: 'postgres' as TargetId, label: 'PostgreSQL' },
      { value: 'mongo' as TargetId, label: 'MongoDB' },
    ],
    output: process.stderr,
  });
  if (clack.isCancel(targetResult)) {
    clack.cancel('Init cancelled.', { output: process.stderr });
    process.exit(0);
  }
  const target = targetResult as TargetId;

  const authoringResult = await clack.select({
    message: 'How do you want to write your schema?',
    options: [
      { value: 'psl' as AuthoringId, label: 'Prisma Schema Language (.prisma)' },
      { value: 'typescript' as AuthoringId, label: 'TypeScript (.ts)' },
    ],
    output: process.stderr,
  });
  if (clack.isCancel(authoringResult)) {
    clack.cancel('Init cancelled.', { output: process.stderr });
    process.exit(0);
  }
  const authoring = authoringResult as AuthoringId;

  const schemaPathResult = await clack.text({
    message: 'Where should the schema file go?',
    initialValue: defaultSchemaPath(authoring),
    output: process.stderr,
  });
  if (clack.isCancel(schemaPathResult)) {
    clack.cancel('Init cancelled.', { output: process.stderr });
    process.exit(0);
  }
  const schemaPath = schemaPathResult as string;

  const schemaDir = dirname(schemaPath);
  const configPath =
    schemaPath.startsWith('./') || isAbsolute(schemaPath) ? schemaPath : `./${schemaPath}`;

  const files: FileEntry[] = [
    { path: schemaPath, content: starterSchema(target, authoring) },
    { path: 'prisma-next.config.ts', content: configFile(target, configPath) },
    { path: join(schemaDir, 'db.ts'), content: dbFile(target) },
    { path: 'prisma-next.md', content: quickReferenceMd(target, schemaPath) },
    { path: '.agents/skills/prisma-next/SKILL.md', content: agentSkillMd(target, schemaPath) },
  ];

  for (const file of files) {
    const fullPath = join(baseDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }

  const tsconfigPath = join(baseDir, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const existing = readFileSync(tsconfigPath, 'utf-8');
    writeFileSync(tsconfigPath, mergeTsConfig(existing), 'utf-8');
    ui.log('Updated tsconfig.json with required compiler options.');
  } else {
    writeFileSync(tsconfigPath, defaultTsConfig(), 'utf-8');
  }

  const pm = await detectPackageManager(baseDir);
  const emitCommand = formatRunCommand(pm, 'prisma-next', 'contract emit');

  if (options.noInstall) {
    const pkg = targetPackageName(target);
    ui.note(
      [
        'Run the following commands to complete setup:',
        '',
        '  1. Install dependencies:',
        `     ${pm} add ${pkg} dotenv && ${pm} add -D @prisma-next/cli`,
        '',
        '  2. Emit the contract:',
        `     ${emitCommand}`,
      ].join('\n'),
      'Manual steps',
    );
  } else {
    ui.log(`Detected package manager: ${pm}`);

    const pkg = targetPackageName(target);
    const spinner = ui.spinner();
    let installSucceeded = false;

    const exec = promisify(execFile);

    spinner.start(`Installing ${pkg}, dotenv, and @prisma-next/cli...`);
    try {
      await exec(pm, ['add', pkg, 'dotenv'], { cwd: baseDir });
      await exec(pm, ['add', '-D', '@prisma-next/cli'], { cwd: baseDir });
      spinner.stop(`Installed ${pkg}, dotenv, and @prisma-next/cli`);
      installSucceeded = true;
    } catch {
      spinner.stop('Installation failed');
      ui.warn(
        [
          'Could not install dependencies automatically. Run manually:',
          `  ${pm} add ${pkg} dotenv`,
          `  ${pm} add -D @prisma-next/cli`,
        ].join('\n'),
      );
    }

    if (installSucceeded) {
      spinner.start('Emitting contract...');
      try {
        const { executeContractEmit } = await import('../../control-api/operations/contract-emit');
        const configFilePath = join(baseDir, 'prisma-next.config.ts');
        await executeContractEmit({ configPath: configFilePath });
        spinner.stop('Contract emitted');
      } catch {
        spinner.stop('Contract emission failed');
        ui.warn(
          ['Could not emit contract automatically. Run manually:', `  ${emitCommand}`].join('\n'),
        );
      }
    }
  }

  clack.outro('Done! Open prisma-next.md to get started.', { output: process.stderr });
}
