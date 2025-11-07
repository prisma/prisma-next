import type { StorageColumn } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import type {
  ColumnBuilder,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  ParamPlaceholder,
  ParamRef,
} from './types';
import type { ExtensionPack, OperationManifest } from '@prisma-next/emitter/types';

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

export function attachOperationsToColumnBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
>(
  columnBuilder: ColumnBuilder<ColumnName, ColumnMeta, JsType>,
  columnMeta: ColumnMeta,
  registry: OperationRegistry | undefined,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ColumnBuilder<ColumnName, ColumnMeta, JsType> {
  if (!registry) {
    return columnBuilder;
  }

  const typeId = columnMeta.type;
  if (!typeId) {
    return columnBuilder;
  }

  const operations = registry.byType(typeId);
  if (operations.length === 0) {
    return columnBuilder;
  }

  const builderWithOps = columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType> & {
    [method: string]: (...args: unknown[]) => ColumnBuilder<string, StorageColumn, unknown>;
  };

  for (const operation of operations) {
    if (operation.capabilities && operation.capabilities.length > 0) {
      if (!contractCapabilities) {
        continue;
      }

      const hasAllCapabilities = operation.capabilities.every((cap) => {
        const [namespace, ...rest] = cap.split('.');
        const key = rest.join('.');
        const namespaceCaps = contractCapabilities[namespace];
        return namespaceCaps?.[key] === true;
      });

      if (!hasAllCapabilities) {
        continue;
      }
    }
    builderWithOps[operation.method] = function (
      this: ColumnBuilder<ColumnName, ColumnMeta, JsType>,
      ...args: unknown[]
    ) {
      if (args.length !== operation.args.length) {
        throw planInvalid(
          `Operation ${operation.method} expects ${operation.args.length} arguments, got ${args.length}`,
        );
      }

      const selfRef: ColumnRef = {
        kind: 'col',
        table: this.table,
        column: this.column,
      };

      const operationArgs: Array<ColumnRef | ParamRef | LiteralExpr> = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const argSpec = operation.args[i];
        if (!argSpec) {
          throw planInvalid(`Missing argument spec for argument ${i}`);
        }

        if (argSpec.kind === 'param') {
          if (!arg || typeof arg !== 'object' || !('kind' in arg) || arg.kind !== 'param-placeholder') {
            throw planInvalid(`Argument ${i} must be a parameter placeholder`);
          }
          operationArgs.push({
            kind: 'param',
            index: 0,
            name: (arg as { name: string }).name,
          });
        } else if (argSpec.kind === 'typeId') {
          if (!arg || typeof arg !== 'object' || !('kind' in arg) || arg.kind !== 'column') {
            throw planInvalid(`Argument ${i} must be a ColumnBuilder`);
          }
          const colBuilder = arg as ColumnBuilder<string, StorageColumn, unknown>;
          operationArgs.push({
            kind: 'col',
            table: colBuilder.table,
            column: colBuilder.column,
          });
        } else if (argSpec.kind === 'literal') {
          operationArgs.push({
            kind: 'literal',
            value: arg,
          });
        }
      }

      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: operation.method,
        forTypeId: operation.forTypeId,
        self: selfRef,
        args: operationArgs,
        returns: operation.returns,
        lowering: operation.lowering,
      };

      const returnTypeId =
        operation.returns.kind === 'typeId' ? operation.returns.type : undefined;
      const returnColumnMeta: StorageColumn = {
        ...columnMeta,
        type: returnTypeId,
      };

      const result = Object.freeze({
        kind: 'column' as const,
        table: this.table,
        column: this.column,
        get columnMeta() {
          return returnColumnMeta;
        },
        eq(value: ParamPlaceholder) {
          return Object.freeze({
            kind: 'binary' as const,
            op: 'eq' as const,
            left: operationExpr,
            right: value,
          });
        },
        asc() {
          return Object.freeze({
            kind: 'order' as const,
            expr: operationExpr,
            dir: 'asc' as const,
          });
        },
        desc() {
          return Object.freeze({
            kind: 'order' as const,
            expr: operationExpr,
            dir: 'desc' as const,
          });
        },
        _operationExpr: operationExpr,
      }) as ColumnBuilder<string, StorageColumn, unknown> & {
        _operationExpr?: OperationExpr;
      };
      return result;
    };
  }

  return builderWithOps;
}

export function assembleOperationRegistry(
  packs: ReadonlyArray<ExtensionPack>,
): OperationRegistry {
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
        ...(operationManifest.capabilities
          ? { capabilities: operationManifest.capabilities }
          : {}),
      };

      registry.register(signature);
    }
  }

  return registry;
}

