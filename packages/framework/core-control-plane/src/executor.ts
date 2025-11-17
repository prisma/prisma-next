import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from './types';

/**
 * Removes readonly modifiers from all properties of a type.
 */
type Writable<T> = { -readonly [P in keyof T]: T[P] };

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
  readonly typeCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Derives summary message from verification result.
 */
function deriveSummary(ok: boolean, code?: string): string {
  if (ok) {
    return 'Database matches contract';
  }
  switch (code) {
    case 'PN-RTM-3001':
      return 'Marker missing';
    case 'PN-RTM-3002':
      return 'Hash mismatch';
    case 'PN-RTM-3003':
      return 'Target mismatch';
    default:
      return 'Verification failed';
  }
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
  private readonly family: FamilyDescriptor;
  private readonly adapter: AdapterDescriptor;
  private readonly target: TargetDescriptor;
  private readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  private readonly contractIR: unknown;

  constructor(options: {
    readonly driver: ControlPlaneDriver;
    readonly family: FamilyDescriptor;
    readonly adapter: AdapterDescriptor;
    readonly target: TargetDescriptor;
    readonly extensions: ReadonlyArray<ExtensionDescriptor>;
    readonly contractIR: unknown;
  }) {
    this.driver = options.driver;
    this.family = options.family;
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
    if (!this.family.readMarker) {
      throw new Error('Family readMarker() is required');
    }
    return this.family.readMarker(this.driver);
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

    // Compute type coverage (optional)
    let missingCodecs: readonly string[] | undefined;
    let typeCoverageSkipped = false;
    if (this.family.supportedTypeIds) {
      const descriptors = [this.adapter, this.target, ...this.extensions];
      const supportedTypeIds = this.family.supportedTypeIds(descriptors);
      if (supportedTypeIds.length === 0) {
        // Helper is present but returns empty (MVP behavior)
        // Coverage check is skipped - missingCodecs remains undefined
        typeCoverageSkipped = true;
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
      const code = 'PN-RTM-3001';
      const result: Writable<VerifyDatabaseResult> = {
        ok: false,
        code,
        summary: deriveSummary(false, code),
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        target: {
          expected: expectedTargetId,
        },
        timings: {
          total: totalTime,
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
      };
      if (missingCodecs) result.missingCodecs = missingCodecs;
      if (typeCoverageSkipped) result.typeCoverageSkipped = typeCoverageSkipped;
      return result satisfies VerifyDatabaseResult;
    }

    // Compare target
    if (contractTarget !== expectedTargetId) {
      const totalTime = Date.now() - startTime;
      const code = 'PN-RTM-3003';
      const result: Writable<VerifyDatabaseResult> = {
        ok: false,
        code,
        summary: deriveSummary(false, code),
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        marker: {
          coreHash: marker.coreHash,
          ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
        },
        target: {
          expected: expectedTargetId,
          actual: contractTarget,
        },
        timings: {
          total: totalTime,
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
      };
      if (missingCodecs) result.missingCodecs = missingCodecs;
      if (typeCoverageSkipped) result.typeCoverageSkipped = typeCoverageSkipped;
      return result satisfies VerifyDatabaseResult;
    }

    // Compare hashes
    if (marker.coreHash !== contractCoreHash) {
      const totalTime = Date.now() - startTime;
      const code = 'PN-RTM-3002';
      const result: Writable<VerifyDatabaseResult> = {
        ok: false,
        code,
        summary: deriveSummary(false, code),
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        marker: {
          coreHash: marker.coreHash,
          ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
        },
        target: {
          expected: expectedTargetId,
        },
        timings: {
          total: totalTime,
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
      };
      if (missingCodecs) result.missingCodecs = missingCodecs;
      if (typeCoverageSkipped) result.typeCoverageSkipped = typeCoverageSkipped;
      return result satisfies VerifyDatabaseResult;
    }

    // Compare profile hash if present
    if (contractProfileHash && marker.profileHash !== contractProfileHash) {
      const totalTime = Date.now() - startTime;
      const code = 'PN-RTM-3002';
      const result: Writable<VerifyDatabaseResult> = {
        ok: false,
        code,
        summary: deriveSummary(false, code),
        contract: {
          coreHash: contractCoreHash,
          profileHash: contractProfileHash,
        },
        marker: {
          coreHash: marker.coreHash,
          ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
        },
        target: {
          expected: expectedTargetId,
        },
        timings: {
          total: totalTime,
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
      };
      if (missingCodecs) result.missingCodecs = missingCodecs;
      if (typeCoverageSkipped) result.typeCoverageSkipped = typeCoverageSkipped;
      return result satisfies VerifyDatabaseResult;
    }

    // Success - all checks passed
    const totalTime = Date.now() - startTime;
    const result: Writable<VerifyDatabaseResult> = {
      ok: true,
      summary: deriveSummary(true),
      contract: {
        coreHash: contractCoreHash,
        ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
      },
      marker: {
        coreHash: marker.coreHash,
        ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
      },
      target: {
        expected: expectedTargetId,
      },
      timings: {
        total: totalTime,
      },
      meta: {
        contractPath,
        ...(configPath ? { configPath } : {}),
      },
    };
    if (missingCodecs) result.missingCodecs = missingCodecs;
    if (typeCoverageSkipped) result.typeCoverageSkipped = typeCoverageSkipped;
    return result satisfies VerifyDatabaseResult;
  }

  /**
   * Closes the database connection.
   */
  async close(): Promise<void> {
    await this.driver.close();
  }
}
