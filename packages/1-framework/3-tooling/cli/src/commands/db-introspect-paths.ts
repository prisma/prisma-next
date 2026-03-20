import { dirname, resolve } from 'pathe';

interface DbIntrospectPathOptions {
  readonly output?: string;
}

/**
 * Resolves the output path for the introspected PSL file.
 *
 * Priority:
 * 1. --output <path> flag (resolved relative to cwd)
 * 2. schema.prisma next to config.contract.output
 * 3. Canonical default: schema.prisma in cwd
 */
export function resolveDbIntrospectOutputPath(
  options: DbIntrospectPathOptions,
  contractOutput: string | undefined,
): string {
  if (options.output) {
    return resolve(process.cwd(), options.output);
  }
  if (contractOutput) {
    const contractPath = resolve(process.cwd(), contractOutput);
    return resolve(dirname(contractPath), 'schema.prisma');
  }
  return resolve(process.cwd(), 'schema.prisma');
}
