export type ArgSpec =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'param' }
  | { readonly kind: 'literal' };

export type ReturnSpec =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'builtin'; readonly type: 'number' | 'boolean' | 'string' };

export interface OperationSignature {
  readonly forTypeId: string;
  readonly method: string;
  readonly args: ReadonlyArray<ArgSpec>;
  readonly returns: ReturnSpec;
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

export function hasAllCapabilities(
  capabilities: ReadonlyArray<string>,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): boolean {
  if (!contractCapabilities) {
    return false;
  }

  return capabilities.every((cap) => {
    const [namespace, ...rest] = cap.split('.');
    const key = rest.join('.');
    const namespaceCaps = namespace ? contractCapabilities[namespace] : undefined;
    return namespaceCaps?.[key] === true;
  });
}
