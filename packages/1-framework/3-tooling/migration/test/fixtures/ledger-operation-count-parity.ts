import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import type { AggregateMigrationEdgeRef } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { expect } from 'vitest';

export const MULTI_EDGE_OPERATION_COUNTS = [1, 2, 1] as const;

export function ledgerOperationCounts(entries: readonly LedgerEntryRecord[]): readonly number[] {
  return entries.map((entry) => entry.operationCount);
}

export function assertOperationCountsMatchAcrossBackends(
  countsByBackend: Readonly<Record<string, readonly number[]>>,
): void {
  const labels = Object.keys(countsByBackend);
  if (labels.length === 0) {
    throw new Error('expected at least one backend');
  }
  const reference = countsByBackend[labels[0]!]!;
  for (const label of labels.slice(1)) {
    expect(countsByBackend[label]).toEqual(reference);
  }
}

export function buildMultiEdgeRefs(destHash: string): readonly AggregateMigrationEdgeRef[] {
  const hashA = 'sha256:parity-mid-a';
  const hashB = 'sha256:parity-mid-b';
  const edgeSpecs = [
    {
      migrationHash: 'sha256:parity-mig-a',
      dirName: '001_a',
      from: EMPTY_CONTRACT_HASH,
      to: hashA,
    },
    {
      migrationHash: 'sha256:parity-mig-b',
      dirName: '002_b',
      from: hashA,
      to: hashB,
    },
    {
      migrationHash: 'sha256:parity-mig-c',
      dirName: '003_c',
      from: hashB,
      to: destHash,
    },
  ] as const;
  return edgeSpecs.map((edge, index) => ({
    ...edge,
    operationCount: MULTI_EDGE_OPERATION_COUNTS[index]!,
  }));
}
