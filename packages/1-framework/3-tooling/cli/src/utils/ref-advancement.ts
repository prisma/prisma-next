import type { ContractIR } from '@prisma-next/migration-tools/refs';
import { writeRefPaired } from '@prisma-next/migration-tools/refs';

export function computeRefAdvancementName(options: {
  readonly advanceRef?: string;
  readonly db?: string;
}): string | null {
  if (options.advanceRef !== undefined) {
    return options.advanceRef;
  }
  if (options.db === undefined) {
    return 'db';
  }
  return null;
}

export async function executeRefAdvancement(
  refsDir: string,
  name: string,
  hash: string,
  contractIR: ContractIR,
): Promise<{ name: string; hash: string }> {
  await writeRefPaired(refsDir, name, { hash, invariants: [] }, contractIR);
  return { name, hash };
}
