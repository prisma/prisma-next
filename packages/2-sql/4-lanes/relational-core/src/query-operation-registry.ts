export interface QueryOperationEntry {
  readonly args: readonly { readonly codecId: string; readonly nullable: boolean }[];
  readonly returns: { readonly codecId: string; readonly nullable: boolean };
  readonly lowering: {
    readonly targetFamily: 'sql';
    readonly strategy: 'infix' | 'function';
    readonly template: string;
  };
}

export interface QueryOperationDescriptor extends QueryOperationEntry {
  readonly method: string;
}

export interface QueryOperationRegistry {
  register(descriptor: QueryOperationDescriptor): void;
  entries(): Readonly<Record<string, QueryOperationEntry>>;
}

export function createQueryOperationRegistry(): QueryOperationRegistry {
  const map = new Map<string, QueryOperationEntry>();

  return {
    register(descriptor) {
      if (map.has(descriptor.method)) {
        throw new Error(`Query operation "${descriptor.method}" is already registered`);
      }
      const { method: _, ...entry } = descriptor;
      map.set(descriptor.method, entry);
    },
    entries() {
      return Object.freeze(Object.fromEntries(map));
    },
  };
}
