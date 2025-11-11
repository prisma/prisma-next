import type { OperationManifest, ExtensionPack, TypesImportSpec } from '@prisma-next/emitter';
import {
  createSqlOperationRegistry,
  register,
  type SqlOperationSignature,
  type SqlOperationRegistry,
} from '@prisma-next/sql-operations';

/**
 * Converts an OperationManifest (from ExtensionPackManifest) to a SqlOperationSignature.
 */
export function operationManifestToSignature(
  manifest: OperationManifest,
): SqlOperationSignature {
  return {
    forTypeId: manifest.for,
    method: manifest.method,
    args: manifest.args.map((arg) => {
      if (arg.kind === 'typeId') {
        if (!arg.type) {
          throw new Error('typeId arg must have type property');
        }
        return { kind: 'typeId' as const, type: arg.type };
      }
      if (arg.kind === 'param') {
        return { kind: 'param' as const };
      }
      if (arg.kind === 'literal') {
        return { kind: 'literal' as const };
      }
      throw new Error(`Invalid arg kind: ${(arg as { kind: unknown }).kind}`);
    }),
    returns: (() => {
      if (manifest.returns.kind === 'typeId') {
        return { kind: 'typeId' as const, type: manifest.returns.type };
      }
      if (manifest.returns.kind === 'builtin') {
        return {
          kind: 'builtin' as const,
          type: manifest.returns.type as 'number' | 'boolean' | 'string',
        };
      }
      throw new Error(
        `Invalid return kind: ${(manifest.returns as { kind: unknown }).kind}`,
      );
    })(),
    lowering: {
      targetFamily: 'sql',
      strategy: manifest.lowering.strategy,
      template: manifest.lowering.template,
    },
    ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
  };
}

/**
 * Assembles an operation registry from extension packs.
 * Extracts OperationManifest[] from packs, converts them to SqlOperationSignature,
 * and registers them in a new registry.
 */
export function assembleOperationRegistryFromPacks(
  packs: ReadonlyArray<ExtensionPack>,
): SqlOperationRegistry {
  const registry = createSqlOperationRegistry();

  for (const pack of packs) {
    const operations = pack.manifest.operations ?? [];
    for (const operationManifest of operations) {
      const signature = operationManifestToSignature(operationManifest);
      register(registry, signature);
    }
  }

  return registry;
}

/**
 * Extracts type imports from extension packs for contract.d.ts generation.
 */
export function extractTypeImports(
  packs: ReadonlyArray<ExtensionPack>,
): ReadonlyArray<TypesImportSpec> {
  const imports: TypesImportSpec[] = [];

  for (const pack of packs) {
    const codecTypes = pack.manifest.types?.codecTypes;
    if (codecTypes?.import) {
      imports.push(codecTypes.import);
    }

    const operationTypes = pack.manifest.types?.operationTypes;
    if (operationTypes?.import) {
      imports.push(operationTypes.import);
    }
  }

  return imports;
}

/**
 * Extracts extension IDs from packs for extension validation.
 */
export function extractExtensionIds(
  packs: ReadonlyArray<ExtensionPack>,
): ReadonlyArray<string> {
  return packs.map((pack) => pack.manifest.id);
}

