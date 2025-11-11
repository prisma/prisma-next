import type {
  OperationSignature as CoreOperationSignature,
  OperationRegistry,
} from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';
import { type } from 'arktype';

export interface LoweringSpec {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface OperationSignature extends CoreOperationSignature {
  readonly lowering: LoweringSpec;
}

export interface OperationManifestLike {
  readonly for: string;
  readonly method: string;
  readonly args: ReadonlyArray<{
    readonly kind: 'typeId' | 'param' | 'literal';
    readonly type?: string;
  }>;
  readonly returns:
    | { readonly kind: 'typeId'; readonly type: string }
    | { readonly kind: 'builtin'; readonly type: 'number' | 'boolean' | 'string' };
  readonly lowering: {
    readonly strategy: 'infix' | 'function';
    readonly template: string;
  };
  readonly capabilities?: ReadonlyArray<string>;
}

export function assembleOperationRegistry(
  manifests: ReadonlyArray<OperationManifestLike>,
): OperationRegistry {
  const registry = createOperationRegistry();

  for (const operationManifest of manifests) {
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

  return registry;
}

const ArgSpecManifestSchema = type({
  kind: "'typeId' | 'param' | 'literal'",
  'type?': 'string',
});

const ReturnSpecManifestSchema = type({
  kind: "'typeId' | 'builtin'",
  'type?': 'string',
});

const LoweringSpecManifestSchema = type({
  strategy: "'infix' | 'function'",
  template: 'string',
});

const OperationManifestLikeSchema = type({
  for: 'string',
  method: 'string',
  args: ArgSpecManifestSchema.array(),
  returns: ReturnSpecManifestSchema,
  lowering: LoweringSpecManifestSchema,
  'capabilities?': 'string[]',
});

export function validateOperationManifest(value: unknown): OperationManifestLike {
  const result = OperationManifestLikeSchema(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid operation manifest: ${messages}`);
  }
  return result as OperationManifestLike;
}

export function validateOperationManifests(value: unknown): ReadonlyArray<OperationManifestLike> {
  const result = OperationManifestLikeSchema.array()(value);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid operation manifests: ${messages}`);
  }
  return result as ReadonlyArray<OperationManifestLike>;
}
