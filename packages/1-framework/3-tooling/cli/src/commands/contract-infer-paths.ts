import { dirname, resolve } from 'pathe';

interface ContractInferPathOptions {
  readonly output?: string;
}

/**
 * Resolves the output path for the inferred PSL contract.
 *
 * Priority:
 * 1. --output <path> flag (resolved relative to cwd)
 * 2. contract.prisma next to config.contract.output
 * 3. Canonical default: contract.prisma in cwd
 */
export function resolveContractInferOutputPath(
  options: ContractInferPathOptions,
  contractOutput: string | undefined,
): string {
  if (options.output) {
    return resolve(process.cwd(), options.output);
  }
  if (contractOutput) {
    const contractPath = resolve(process.cwd(), contractOutput);
    return resolve(dirname(contractPath), 'contract.prisma');
  }
  return resolve(process.cwd(), 'contract.prisma');
}
