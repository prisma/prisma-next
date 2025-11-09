import type { ExtensionPack } from '@prisma-next/emitter';

export type ArgSpec =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'param' }
  | { readonly kind: 'literal' };

export type ReturnSpec =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'builtin'; readonly type: 'number' | 'boolean' | 'string' };

export interface LoweringSpec {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface OperationSignature {
  readonly forTypeId: string;
  readonly method: string;
  readonly args: ReadonlyArray<ArgSpec>;
  readonly returns: ReturnSpec;
  readonly lowering: LoweringSpec;
  readonly capabilities?: ReadonlyArray<string>;
}

export interface OperationRegistry {
  register(op: OperationSignature): void;
  byType(typeId: string): ReadonlyArray<OperationSignature>;
}

class OperationRegistryImpl implements OperationRegistry {
  private readonly operations = new Map<string, OperationSignature[]>();

  register(op: OperationSignature): void {
    const existing = this.operations.get(op.forTypeId) ?? [];
    const duplicate = existing.find((existingOp) => existingOp.method === op.method);
    if (duplicate) {
      throw new Error(
        `Operation method "${op.method}" already registered for typeId "${op.forTypeId}"`,
      );
    }
    existing.push(op);
    this.operations.set(op.forTypeId, existing);
  }

  byType(typeId: string): ReadonlyArray<OperationSignature> {
    return this.operations.get(typeId) ?? [];
  }
}

export function createOperationRegistry(): OperationRegistry {
  return new OperationRegistryImpl();
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
