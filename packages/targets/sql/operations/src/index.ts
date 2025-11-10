import type { ExtensionPack } from '@prisma-next/emitter';
import type {
  OperationSignature as CoreOperationSignature,
  OperationRegistry,
} from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';

export interface LoweringSpec {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface OperationSignature extends CoreOperationSignature {
  readonly lowering: LoweringSpec;
}

export function assembleOperationRegistry(packs: ReadonlyArray<ExtensionPack>): OperationRegistry {
  const registry = createOperationRegistry();

  for (const pack of packs) {
    const operations = pack.manifest.operations;
    if (!operations) {
      continue;
    }

    for (const operationManifest of operations) {
      const signature: OperationSignature = {
        forTypeId: operationManifest.for,
        method: operationManifest.method,
        args: operationManifest.args.map((arg) => {
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
          if (operationManifest.returns.kind === 'typeId') {
            return { kind: 'typeId' as const, type: operationManifest.returns.type };
          }
          if (operationManifest.returns.kind === 'builtin') {
            return {
              kind: 'builtin' as const,
              type: operationManifest.returns.type as 'number' | 'boolean' | 'string',
            };
          }
          throw new Error(
            `Invalid return kind: ${(operationManifest.returns as { kind: unknown }).kind}`,
          );
        })(),
        lowering: {
          targetFamily: 'sql',
          strategy: operationManifest.lowering.strategy,
          template: operationManifest.lowering.template,
        },
        ...(operationManifest.capabilities ? { capabilities: operationManifest.capabilities } : {}),
      };

      registry.register(signature);
    }
  }

  return registry;
}
