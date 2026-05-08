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

export type OperationDescriptor<T extends OperationEntry = OperationEntry> = T & {
  readonly method: string;
};

export interface OperationRegistry<T extends OperationEntry = OperationEntry> {
  register(descriptor: OperationDescriptor<T>): void;

  /**
   * All registered descriptors in registration order. Use this when
   * dispatching per-codec — multiple ops can share a method name as
   * long as their `self` discriminators differ (e.g. one trait-gated
   * `ilike` from the postgres adapter and one codec-id-targeted
   * `ilike` from a cipherstash extension).
   */
  all(): readonly OperationDescriptor<T>[];

  /**
   * Method-keyed view, last registration wins. Suitable for the global
   * `fns` namespace exposed by sql-builder where method-name uniqueness
   * is the user-facing surface contract. Per-codec dispatch should use
   * {@link OperationRegistry.all} instead.
   */
  entries(): Readonly<Record<string, T>>;
}

function selfFingerprint(self: SelfSpec | undefined): string {
  if (!self) return '';
  if (self.codecId !== undefined) return `c:${self.codecId}`;
  return `t:${[...(self.traits ?? [])].sort().join(',')}`;
}

export function createOperationRegistry<
  T extends OperationEntry = OperationEntry,
>(): OperationRegistry<T> {
  const descriptors: OperationDescriptor<T>[] = [];
  const fingerprintsByMethod = new Map<string, Set<string>>();

  return {
    register(descriptor: OperationDescriptor<T>) {
      if (descriptor.self) {
        const hasCodecId = descriptor.self.codecId !== undefined;
        const hasTraits = descriptor.self.traits !== undefined && descriptor.self.traits.length > 0;
        if (!hasCodecId && !hasTraits) {
          throw new Error(`Operation "${descriptor.method}" self has neither codecId nor traits`);
        }
        if (hasCodecId && hasTraits) {
          throw new Error(`Operation "${descriptor.method}" self has both codecId and traits`);
        }
      }
      // Reject only exact `(method, self)` collisions. Different `self`
      // discriminators for the same method are allowed so target
      // adapters and extensions can coexist (e.g. postgres registers
      // `ilike` for `traits: ['textual']`; cipherstash registers
      // `ilike` for `codecId: 'cipherstash/string@1'`).
      const fingerprint = selfFingerprint(descriptor.self);
      let fingerprints = fingerprintsByMethod.get(descriptor.method);
      if (!fingerprints) {
        fingerprints = new Set();
        fingerprintsByMethod.set(descriptor.method, fingerprints);
      }
      if (fingerprints.has(fingerprint)) {
        throw new Error(
          `Operation "${descriptor.method}" is already registered with the same self discriminator (${fingerprint || '<no self>'})`,
        );
      }
      fingerprints.add(fingerprint);
      descriptors.push(descriptor);
    },
    all() {
      return Object.freeze(descriptors.slice());
    },
    entries() {
      const out: Record<string, T> = Object.create(null);
      for (const descriptor of descriptors) {
        const { method: _method, ...entry } = descriptor;
        // OperationDescriptor<T> = T & { method }, so stripping method yields T.
        // TypeScript can't prove Omit<T & { method }, 'method'> = T for generic T.
        out[descriptor.method] = entry as unknown as T;
      }
      return Object.freeze(out);
    },
  };
}
