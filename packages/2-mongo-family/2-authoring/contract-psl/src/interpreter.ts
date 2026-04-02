import type { ContractSourceDiagnostics } from '@prisma-next/config/config-types';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ParsePslDocumentResult } from '@prisma-next/psl-parser';
import type { Result } from '@prisma-next/utils/result';

export interface InterpretPslDocumentToMongoContractIRInput {
  readonly document: ParsePslDocumentResult;
  readonly scalarTypeDescriptors: ReadonlyMap<string, string>;
}

export function interpretPslDocumentToMongoContractIR(
  _input: InterpretPslDocumentToMongoContractIRInput,
): Result<ContractIR, ContractSourceDiagnostics> {
  throw new Error('Not implemented');
}
