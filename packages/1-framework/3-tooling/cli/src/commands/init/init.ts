import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import * as clack from '@clack/prompts';
import { dirname, extname, isAbsolute, join, normalize } from 'pathe';
import { TerminalUI } from '../../utils/terminal-ui';
import {
  detectPackageManager,
  formatAddArgs,
  formatAddDevArgs,
  formatRunCommand,
  hasProjectManifest,
} from './detect-package-manager';
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

  if (!hasProjectManifest(baseDir)) {
    ui.error(
      'No package.json or deno.json found. Initialize your project first (e.g. npm init or deno init), then re-run prisma-next init.',
    );
    process.exit(1);
  }

  const pm = await detectPackageManager(baseDir);
  const pkgRun = formatRunCommand(pm, 'prisma-next', '').trimEnd();

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
    validate(value = '') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return 'Path cannot be empty';
      if (trimmed.endsWith('/') || trimmed.endsWith('\\'))
        return 'Path must be a file, not a directory';
      if (!extname(trimmed)) return 'Path must include a file extension (e.g. .prisma or .ts)';
      return undefined;
    },
    output: process.stderr,
  });
  if (clack.isCancel(schemaPathResult)) {
    clack.cancel('Init cancelled.', { output: process.stderr });
    process.exit(0);
  }
  const schemaPath = normalize((schemaPathResult as string).trim());

  const schemaDir = dirname(schemaPath);
  const configPath = isAbsolute(schemaPath) ? schemaPath : `./${schemaPath}`;

  const files: FileEntry[] = [
    { path: schemaPath, content: starterSchema(target, authoring) },
    { path: 'prisma-next.config.ts', content: configFile(target, configPath) },
    { path: join(schemaDir, 'db.ts'), content: dbFile(target) },
    { path: 'prisma-next.md', content: quickReferenceMd(target, schemaPath, pkgRun) },
    {
      path: '.agents/skills/prisma-next/SKILL.md',
      content: agentSkillMd(target, schemaPath, pkgRun),
    },
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

  const emitCommand = formatRunCommand(pm, 'prisma-next', 'contract emit');

  if (options.noInstall) {
    const pkg = targetPackageName(target);
    ui.note(
      [
        'Run the following commands to complete setup:',
        '',
        '  1. Install dependencies:',
        `     ${pm} ${formatAddArgs(pm, [pkg, 'dotenv']).join(' ')}`,
        `     ${pm} ${formatAddDevArgs(pm, ['prisma-next']).join(' ')}`,
        '',
        '  2. Emit the contract:',
        `     ${emitCommand}`,
      ].join('\n'),
      'Manual steps',
    );
  } else {
    const pkg = targetPackageName(target);
    const spinner = ui.spinner();
    let installSucceeded = false;

    const exec = promisify(execFile);

    spinner.start(`Installing ${pkg}, dotenv, and prisma-next...`);
    try {
      await exec(pm, formatAddArgs(pm, [pkg, 'dotenv']), { cwd: baseDir });
      await exec(pm, formatAddDevArgs(pm, ['prisma-next']), { cwd: baseDir });
      spinner.stop(`Installed ${pkg}, dotenv, and prisma-next`);
      installSucceeded = true;
    } catch (err) {
      spinner.stop('Installation failed');
      const stderr =
        err instanceof Error && 'stderr' in err ? (err as { stderr: string }).stderr : '';
      ui.warn(
        [
          'Could not install dependencies automatically.',
          ...(stderr ? [`  ${stderr.trim()}`] : []),
          '',
          'Run manually:',
          `  ${pm} ${formatAddArgs(pm, [pkg, 'dotenv']).join(' ')}`,
          `  ${pm} ${formatAddDevArgs(pm, ['prisma-next']).join(' ')}`,
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
