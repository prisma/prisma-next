import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@prisma-next/migration-tools/aggregate';

export type FabricatedMigrationEdgesPlan = {
  readonly origin?: { readonly storageHash: string } | null;
  readonly destination: { readonly storageHash: string };
  readonly operations: readonly unknown[];
};

export function buildFabricatedMigrationEdges(
  plan: FabricatedMigrationEdgesPlan,
): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}
