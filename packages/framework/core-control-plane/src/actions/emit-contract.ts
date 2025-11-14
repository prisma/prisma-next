import type { ContractIR } from '@prisma-next/contract/ir';
import type { TargetFamilyHook, TypesImportSpec } from '@prisma-next/emitter';
import { emit } from '@prisma-next/emitter';
import type { OperationRegistry } from '@prisma-next/operations';

export interface EmitContractOptions {
  readonly contractIR: ContractIR;
  readonly targetFamily: TargetFamilyHook;
  readonly operationRegistry: OperationRegistry;
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
}

export interface EmitContractResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly coreHash: string;
  readonly profileHash: string;
}

/**
 * Programmatic API for emitting contracts.
 * Accepts resolved contract IR and assembly data.
 * Returns contract JSON and DTS as strings (no file I/O).
 * The caller is responsible for writing the strings to files.
 *
 * @param options - Options for contract emission
 * @returns Result with contract JSON string, DTS string, and hashes
 * @throws Error if contract emission fails
 */
export async function emitContract(
  options: EmitContractOptions,
): Promise<EmitContractResult> {
  try {
    const {
      contractIR,
      targetFamily,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    } = options;

    const result = await emit(
      contractIR,
      {
        outputDir: '', // Not used when returning strings
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      },
      targetFamily,
    );

    return {
      contractJson: result.contractJson,
      contractDts: result.contractDts,
      coreHash: result.coreHash,
      profileHash: result.profileHash,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to emit contract: ${String(error)}`);
  }
}

