export interface MigrationListEntry {
  readonly name: string;
  readonly fromContract: string | null;
  readonly toContract: string;
  readonly migrationHash: string;
  readonly operationCount: number;
  readonly createdAt: string;
  readonly refs: readonly string[];
  readonly providedInvariants: readonly string[];
}

export interface MigrationSpaceListEntry {
  readonly space: string;
  readonly migrations: readonly MigrationListEntry[];
}

export interface MigrationListResult {
  readonly ok: true;
  readonly spaces: readonly MigrationSpaceListEntry[];
  readonly summary: string;
}
