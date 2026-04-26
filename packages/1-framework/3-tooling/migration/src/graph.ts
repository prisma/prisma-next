/**
 * An entry in the migration graph. All on-disk migrations are attested,
 * so `migrationHash` is always a string.
 */
export interface MigrationChainEntry {
  readonly from: string;
  readonly to: string;
  readonly migrationHash: string;
  readonly dirName: string;
  readonly createdAt: string;
  readonly labels: readonly string[];
}

export interface MigrationGraph {
  readonly nodes: ReadonlySet<string>;
  readonly forwardChain: ReadonlyMap<string, readonly MigrationChainEntry[]>;
  readonly reverseChain: ReadonlyMap<string, readonly MigrationChainEntry[]>;
  readonly migrationById: ReadonlyMap<string, MigrationChainEntry>;
}
