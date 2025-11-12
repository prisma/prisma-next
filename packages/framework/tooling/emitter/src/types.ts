import type { OperationRegistry } from '@prisma-next/operations';

export interface TypesImportSpec {
  readonly package: string;
  readonly named: string;
  readonly alias: string;
}

export interface EmitOptions {
  readonly outputDir: string;
  readonly operationRegistry?: OperationRegistry;
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly coreHash: string;
  readonly profileHash?: string;
}
