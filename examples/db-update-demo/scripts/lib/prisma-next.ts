import { configPath, demoRoot } from './paths';

export interface PrismaNextOptions {
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly allowFailure?: boolean;
}

export async function runPrismaNext(
  args: readonly string[],
  options: PrismaNextOptions = {},
): Promise<number> {
  const proc = Bun.spawn(['pnpm', 'exec', 'prisma-next', ...args], {
    cwd: options.cwd ?? demoRoot,
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`prisma-next failed (exit code ${exitCode}).`);
  }
  return exitCode;
}

export function baseArgs(): string[] {
  return ['--config', configPath, '--no-color'];
}
