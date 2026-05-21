import { readFile } from 'node:fs/promises';
import type { ContractIR } from '@prisma-next/migration-tools/refs';
import { writeRefPaired } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';

export interface RefAdvancementFields {
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef: { readonly name: string; readonly hash: string } | null;
}

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

export async function readContractIR(
  contractJson: Record<string, unknown>,
  contractJsonPath: string,
): Promise<ContractIR> {
  const contractDtsPath = contractJsonPath.replace(/\.json$/i, '.d.ts');
  const contractDts = await readFile(contractDtsPath, 'utf-8');
  return { contract: contractJson, contractDts };
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

export async function buildRefAdvancementFields(options: {
  readonly advanceRef?: string;
  readonly db?: string;
  readonly refsDir: string;
  readonly contractIR: ContractIR;
  readonly mode: 'plan' | 'apply';
  readonly hash: string;
}): Promise<RefAdvancementFields> {
  const name = computeRefAdvancementName({
    ...ifDefined('advanceRef', options.advanceRef),
    ...ifDefined('db', options.db),
  });
  if (name === null) {
    return { advancedRef: null, plannedAdvanceRef: null };
  }
  if (options.mode === 'plan') {
    return { advancedRef: null, plannedAdvanceRef: { name, hash: options.hash } };
  }
  const advancedRef = await executeRefAdvancement(
    options.refsDir,
    name,
    options.hash,
    options.contractIR,
  );
  return { advancedRef, plannedAdvanceRef: null };
}
