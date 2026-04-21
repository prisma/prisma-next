export interface ParamSpec {
  readonly codecId?: string;
  readonly traits?: readonly string[];
  readonly nullable: boolean;
}

export interface ReturnSpec {
  readonly codecId: string;
  readonly nullable: boolean;
}

export interface OperationEntry {
  readonly args: readonly ParamSpec[];
  readonly returns: ReturnSpec;
}

export type OperationDescriptor<T extends OperationEntry = OperationEntry> = T & {
  readonly method: string;
};

export interface OperationRegistry<T extends OperationEntry = OperationEntry> {
  register(descriptor: OperationDescriptor<T>): void;
  entries(): Readonly<Record<string, T>>;
}

export function createOperationRegistry<
  T extends OperationEntry = OperationEntry,
>(): OperationRegistry<T> {
  const operations: Record<string, T> = Object.create(null);

  return {
    register(descriptor: OperationDescriptor<T>) {
      if (descriptor.method in operations) {
        throw new Error(`Operation "${descriptor.method}" is already registered`);
      }
      descriptor.args.forEach((arg, i) => {
        const hasCodecId = arg.codecId !== undefined;
        const hasTraits = arg.traits !== undefined && arg.traits.length > 0;
        if (!hasCodecId && !hasTraits) {
          throw new Error(
            `Operation "${descriptor.method}" arg[${i}] has neither codecId nor traits`,
          );
        }
        if (hasCodecId && hasTraits) {
          throw new Error(`Operation "${descriptor.method}" arg[${i}] has both codecId and traits`);
        }
      });
      const { method: _method, ...entry } = descriptor;
      // OperationDescriptor<T> = T & { method }, so stripping method yields T.
      // TypeScript can't prove Omit<T & { method }, 'method'> = T for generic T.
      operations[descriptor.method] = entry as unknown as T;
    },
    entries() {
      return Object.freeze({ ...operations });
    },
  };
}
