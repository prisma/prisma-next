export interface StorageColumn {
  readonly type?: string;
  readonly nullable?: boolean;
}

export interface StorageTable {
  readonly columns: Record<string, StorageColumn>;
}

export interface ContractStorage {
  readonly tables: Record<string, StorageTable>;
}

export interface DataContract {
  readonly target: string;
  readonly targetFamily?: string;
  readonly coreHash: string;
  readonly profileHash?: string;
  readonly storage: ContractStorage;
}

