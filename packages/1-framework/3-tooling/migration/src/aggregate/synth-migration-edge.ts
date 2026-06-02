import type { AggregateMigrationEdgeRef } from './planner-types';

export function buildSynthMigrationEdge(args: {
  readonly currentMarkerStorageHash: string | null | undefined;
  readonly destinationStorageHash: string;
  readonly operationCount: number;
}): AggregateMigrationEdgeRef {
  return {
    dirName: '',
    migrationHash: args.destinationStorageHash,
    from: args.currentMarkerStorageHash ?? '',
    to: args.destinationStorageHash,
    operationCount: args.operationCount,
  };
}
