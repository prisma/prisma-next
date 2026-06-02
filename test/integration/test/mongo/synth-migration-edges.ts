import {
  type AggregateMigrationEdgeRef,
  buildSynthMigrationEdge,
} from '@prisma-next/migration-tools/aggregate';

export type SynthMigrationEdgesPlan = {
  readonly origin?: { readonly storageHash: string } | null;
  readonly destination: { readonly storageHash: string };
  readonly operations: readonly unknown[];
};

export function synthMigrationEdges(
  plan: SynthMigrationEdgesPlan,
): readonly AggregateMigrationEdgeRef[] {
  return [
    buildSynthMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}
