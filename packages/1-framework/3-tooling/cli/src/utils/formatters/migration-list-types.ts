export interface MigrationListEntry {
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
  readonly operationCount: number;
  readonly createdAt: string;
  readonly refs: readonly string[];
  readonly providedInvariants: readonly string[];
}

export interface MigrationSpaceListEntry {
  readonly spaceId: string;
  readonly migrations: readonly MigrationListEntry[];
}

export interface MigrationListResult {
  readonly ok: true;
  readonly spaces: readonly MigrationSpaceListEntry[];
  readonly summary: string;
}
