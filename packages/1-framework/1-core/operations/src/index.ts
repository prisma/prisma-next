export interface ParamSpec {
  readonly codecId?: string;
  readonly traits?: readonly string[];
  readonly nullable: boolean;
}

export interface ReturnSpec {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type SelfSpec =
  | { readonly codecId: string; readonly traits?: never }
  | { readonly traits: readonly string[]; readonly codecId?: never };

export interface OperationEntry {
  readonly self?: SelfSpec;
  readonly impl: (...args: never[]) => unknown;
}

export type OperationDescriptor<T extends OperationEntry = OperationEntry> = T;

export type OperationDescriptors<T extends OperationEntry = OperationEntry> = Readonly<
  Record<string, OperationDescriptor<T>>
>;

export interface OperationRegistry<T extends OperationEntry = OperationEntry> {
  register(name: string, descriptor: OperationDescriptor<T>): void;
  entries(): Readonly<Record<string, T>>;
}

export function createOperationRegistry<
  T extends OperationEntry = OperationEntry,
>(): OperationRegistry<T> {
  const operations: Record<string, T> = Object.create(null);

  return {
    register(name: string, descriptor: OperationDescriptor<T>) {
      if (name in operations) {
        throw new Error(`Operation "${name}" is already registered`);
      }
      if (descriptor.self) {
        const hasCodecId = descriptor.self.codecId !== undefined;
        const hasTraits = descriptor.self.traits !== undefined && descriptor.self.traits.length > 0;
        if (!hasCodecId && !hasTraits) {
          throw new Error(`Operation "${name}" self has neither codecId nor traits`);
        }
        if (hasCodecId && hasTraits) {
          throw new Error(`Operation "${name}" self has both codecId and traits`);
        }
      }
      operations[name] = descriptor;
    },
    entries() {
      return Object.freeze({ ...operations });
    },
  };
}
