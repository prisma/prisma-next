import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { TypeRenderEntry, TypesImportSpec } from '@prisma-next/framework-components/emission';

/**
 * The subset of ControlStack that emit() reads.
 * All fields are optional so tests can pass minimal objects.
 * A full ControlStack satisfies this via structural typing.
 */
export interface EmitStackInput {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly parameterizedRenderers?: Map<string, TypeRenderEntry>;
  readonly parameterizedTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly codecLookup?: CodecLookup;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}
