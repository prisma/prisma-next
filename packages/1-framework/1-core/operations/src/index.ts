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
  | { readonly codecId: string; readonly traits?: never; readonly any?: never }
  | { readonly traits: readonly string[]; readonly codecId?: never; readonly any?: never }
  | { readonly any: true; readonly codecId?: never; readonly traits?: never };

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
        const hasAny = descriptor.self.any === true;
        if (!hasCodecId && !hasTraits && !hasAny) {
          throw new Error(`Operation "${name}" self has none of codecId, traits, or any`);
        }
        if (hasCodecId && hasTraits) {
          throw new Error(`Operation "${name}" self combines codecId and traits`);
        }
        if (hasAny && (hasCodecId || hasTraits)) {
          throw new Error(`Operation "${name}" self combines any with codecId or traits`);
        }
      }
      operations[name] = descriptor;
    },
    entries() {
      return Object.freeze({ ...operations });
    },
  };
}
