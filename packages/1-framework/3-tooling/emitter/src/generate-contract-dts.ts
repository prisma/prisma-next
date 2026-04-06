import type { Contract } from '@prisma-next/contract/types';
import type {
  EmissionSpi,
  GenerateContractTypesOptions,
  TypesImportSpec,
} from '@prisma-next/framework-components/emission';

export function generateContractDts(
  contract: Contract,
  emitter: EmissionSpi,
  codecTypeImports: ReadonlyArray<TypesImportSpec>,
  operationTypeImports: ReadonlyArray<TypesImportSpec>,
  hashes: {
    readonly storageHash: string;
    readonly executionHash?: string;
    readonly profileHash: string;
  },
  options?: GenerateContractTypesOptions,
): string {
  return emitter.generateContractTypes(
    contract,
    codecTypeImports,
    operationTypeImports,
    hashes,
    options,
  );
}
