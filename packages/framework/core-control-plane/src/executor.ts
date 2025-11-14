import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from './types';

/**
 * Result type for database verification operations.
 * Returned by ControlPlaneExecutor.verifyAgainst().
 */
export interface VerifyDatabaseResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly marker?: {
    readonly coreHash?: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly missingCodecs?: readonly string[];
  readonly codecCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

type CreateVerifyResultOptions = {
  ok: boolean;
  code?: string;
  summary: string;
  contractCoreHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  missingCodecs?: readonly string[];
  codecCoverageSkipped?: boolean;
  configPath?: string;
  contractPath: string;
  totalTime: number;
};

/**
 * Creates a VerifyDatabaseResult object with common structure.
 * Centralizes result construction to reduce duplication.
 */
function createVerifyResult(options: CreateVerifyResultOptions): VerifyDatabaseResult {
  const contract: { coreHash: string; profileHash?: string } = {
    coreHash: options.contractCoreHash,
  };
  if (options.contractProfileHash) {
    contract.profileHash = options.contractProfileHash;
  }

  const target: { expected: string; actual?: string } = {
    expected: options.expectedTargetId,
  };
  if (options.actualTargetId) {
    target.actual = options.actualTargetId;
  }

  const meta: { contractPath: string; configPath?: string } = {
    contractPath: options.contractPath,
  };
  if (options.configPath) {
    meta.configPath = options.configPath;
  }

  const result: VerifyDatabaseResult = {
    ok: options.ok,
    summary: options.summary,
    contract,
    target,
    meta,
    timings: {
      total: options.totalTime,
    },
  };

  if (options.code) {
    (result as { code?: string }).code = options.code;
  }

  if (options.marker) {
    (result as { marker?: { coreHash: string; profileHash: string } }).marker = {
      coreHash: options.marker.coreHash,
      profileHash: options.marker.profileHash,
    };
  }

  if (options.missingCodecs) {
    (result as { missingCodecs?: readonly string[] }).missingCodecs = options.missingCodecs;
  }

  if (options.codecCoverageSkipped) {
    (result as { codecCoverageSkipped?: boolean }).codecCoverageSkipped =
      options.codecCoverageSkipped;
  }

  return result;
}

/**
 * Extracts codec type IDs used in contract storage tables.
 * Uses type guards to safely access SQL-specific structure without importing SQL types.
 */
function extractCodecTypeIdsFromContract(contract: unknown): readonly string[] {
  const typeIds = new Set<string>();

  // Type guard for SQL contract structure
  if (
    typeof contract === 'object' &&
    contract !== null &&
    'storage' in contract &&
    typeof contract.storage === 'object' &&
    contract.storage !== null &&
    'tables' in contract.storage
  ) {
    const storage = contract.storage as { tables?: Record<string, unknown> };
    if (storage.tables && typeof storage.tables === 'object') {
      for (const table of Object.values(storage.tables)) {
        if (
          typeof table === 'object' &&
          table !== null &&
          'columns' in table &&
          typeof table.columns === 'object' &&
          table.columns !== null
        ) {
          const columns = table.columns as Record<string, { type?: string } | undefined>;
          for (const column of Object.values(columns)) {
            if (
              column &&
              typeof column === 'object' &&
              'type' in column &&
              typeof column.type === 'string'
            ) {
              typeIds.add(column.type);
            }
          }
        }
      }
    }
  }

  return Array.from(typeIds).sort();
}

/**
 * Control Plane executor for database verification operations.
 * Mirrors runtime assembly pattern: adapter + driver + family helpers → executor.
 * Provides thin control-only operations (no encode/decode, no runtime plugins).
 */
export class ControlPlaneExecutor {
  private readonly driver: ControlPlaneDriver;
  private readonly familyVerify: FamilyDescriptor['verify'];
  private readonly adapter: AdapterDescriptor;
  private readonly target: TargetDescriptor;
  private readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  private readonly contractIR: unknown;

  constructor(options: {
    readonly driver: ControlPlaneDriver;
    readonly familyVerify: FamilyDescriptor['verify'];
    readonly adapter: AdapterDescriptor;
    readonly target: TargetDescriptor;
    readonly extensions: ReadonlyArray<ExtensionDescriptor>;
    readonly contractIR: unknown;
  }) {
    this.driver = options.driver;
    this.familyVerify = options.familyVerify;
    this.adapter = options.adapter;
    this.target = options.target;
    this.extensions = options.extensions;
    this.contractIR = options.contractIR;
  }

  /**
   * Reads the contract marker from the database.
   * Delegates to family-provided readMarker() to abstract SQL-specific details.
   */
  async readMarker(): Promise<ContractMarkerRecord | null> {
    if (!this.familyVerify?.readMarker) {
      throw new Error('Family verify.readMarker() is required');
    }
    return this.familyVerify.readMarker(this.driver);
  }

  /**
   * Verifies the contract against the database marker.
   * Compares target, coreHash, and profileHash.
   * Optionally performs codec coverage checks.
   */
  async verifyAgainst(
    expectedTargetId: string,
    startTime: number,
    configPath?: string,
    contractPath = 'src/prisma/contract.json',
  ): Promise<VerifyDatabaseResult> {
    // Type guard to ensure contract has required properties
    if (
      typeof this.contractIR !== 'object' ||
      this.contractIR === null ||
      !('coreHash' in this.contractIR) ||
      !('target' in this.contractIR) ||
      typeof this.contractIR.coreHash !== 'string' ||
      typeof this.contractIR.target !== 'string'
    ) {
      throw new Error('Contract is missing required fields: coreHash or target');
    }

    // Extract contract hashes and target
    const contractCoreHash = this.contractIR.coreHash;
    const contractProfileHash =
      'profileHash' in this.contractIR && typeof this.contractIR.profileHash === 'string'
        ? this.contractIR.profileHash
        : undefined;
    const contractTarget = this.contractIR.target;

    // Read marker from database
    const marker = await this.readMarker();

    // Compute codec coverage (optional)
    let missingCodecs: readonly string[] | undefined;
    let codecCoverageSkipped = false;
    if (this.familyVerify?.collectSupportedCodecTypeIds) {
      const descriptors = [this.adapter, this.target, ...this.extensions];
      const supportedTypeIds = this.familyVerify.collectSupportedCodecTypeIds(descriptors);
      if (supportedTypeIds.length === 0) {
        // Helper is present but returns empty (MVP behavior)
        // Coverage check is skipped - missingCodecs remains undefined
        codecCoverageSkipped = true;
      } else {
        const supportedSet = new Set(supportedTypeIds);
        const usedTypeIds = extractCodecTypeIdsFromContract(this.contractIR);
        const missing = usedTypeIds.filter((id) => !supportedSet.has(id));
        if (missing.length > 0) {
          missingCodecs = missing;
        }
      }
    }

    // Check marker presence
    if (!marker) {
      const totalTime = Date.now() - startTime;
      const options: CreateVerifyResultOptions = {
        ok: false,
        code: 'PN-RTM-3001',
        summary: 'Marker missing',
        contractCoreHash,
        expectedTargetId,
        contractPath,
        totalTime,
      };
      if (contractProfileHash) options.contractProfileHash = contractProfileHash;
      if (missingCodecs) options.missingCodecs = missingCodecs;
      if (codecCoverageSkipped) options.codecCoverageSkipped = codecCoverageSkipped;
      if (configPath) options.configPath = configPath;
      return createVerifyResult(options);
    }

    // Compare target
    if (contractTarget !== expectedTargetId) {
      const totalTime = Date.now() - startTime;
      const options: CreateVerifyResultOptions = {
        ok: false,
        code: 'PN-RTM-3003',
        summary: 'Target mismatch',
        contractCoreHash,
        marker,
        expectedTargetId,
        actualTargetId: contractTarget,
        contractPath,
        totalTime,
      };
      if (contractProfileHash) options.contractProfileHash = contractProfileHash;
      if (missingCodecs) options.missingCodecs = missingCodecs;
      if (codecCoverageSkipped) options.codecCoverageSkipped = codecCoverageSkipped;
      if (configPath) options.configPath = configPath;
      return createVerifyResult(options);
    }

    // Compare hashes
    if (marker.coreHash !== contractCoreHash) {
      const totalTime = Date.now() - startTime;
      const options: CreateVerifyResultOptions = {
        ok: false,
        code: 'PN-RTM-3002',
        summary: 'Hash mismatch',
        contractCoreHash,
        marker,
        expectedTargetId,
        contractPath,
        totalTime,
      };
      if (contractProfileHash) options.contractProfileHash = contractProfileHash;
      if (missingCodecs) options.missingCodecs = missingCodecs;
      if (codecCoverageSkipped) options.codecCoverageSkipped = codecCoverageSkipped;
      if (configPath) options.configPath = configPath;
      return createVerifyResult(options);
    }

    // Compare profile hash if present
    if (contractProfileHash && marker.profileHash !== contractProfileHash) {
      const totalTime = Date.now() - startTime;
      const options: CreateVerifyResultOptions = {
        ok: false,
        code: 'PN-RTM-3002',
        summary: 'Hash mismatch',
        contractCoreHash,
        contractProfileHash,
        marker,
        expectedTargetId,
        contractPath,
        totalTime,
      };
      if (missingCodecs) options.missingCodecs = missingCodecs;
      if (codecCoverageSkipped) options.codecCoverageSkipped = codecCoverageSkipped;
      if (configPath) options.configPath = configPath;
      return createVerifyResult(options);
    }

    // Success - all checks passed
    const totalTime = Date.now() - startTime;
    const options: CreateVerifyResultOptions = {
      ok: true,
      summary: 'Database matches contract',
      contractCoreHash,
      marker,
      expectedTargetId,
      contractPath,
      totalTime,
    };
    if (contractProfileHash) options.contractProfileHash = contractProfileHash;
    if (missingCodecs) options.missingCodecs = missingCodecs;
    if (codecCoverageSkipped) options.codecCoverageSkipped = codecCoverageSkipped;
    if (configPath) options.configPath = configPath;
    return createVerifyResult(options);
  }

  /**
   * Closes the database connection.
   */
  async close(): Promise<void> {
    await this.driver.close();
  }
}
