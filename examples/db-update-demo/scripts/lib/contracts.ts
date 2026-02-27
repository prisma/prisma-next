import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contractJsonPath, contractPath, contractsDir } from './paths';

export type ContractVariant = 'v1' | 'v2';

const contractFiles: Record<ContractVariant, string> = {
  v1: 'contract-v1.ts',
  v2: 'contract-v2-add-slug.ts',
};

export function applyContract(variant: ContractVariant): void {
  const source = resolve(contractsDir, contractFiles[variant]);
  copyFileSync(source, contractPath);
}

export function readContractHashes(): { storageHash: string; profileHash?: string } {
  const json = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as {
    storageHash: string;
    profileHash?: string | null;
  };
  return {
    storageHash: json.storageHash,
    ...(json.profileHash ? { profileHash: json.profileHash } : {}),
  };
}
