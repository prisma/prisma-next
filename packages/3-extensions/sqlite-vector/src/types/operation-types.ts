/**
 * Operation type definitions for sqlite-vector extension.
 *
 * This file exports type-only definitions for operation method signatures.
 * These types are imported by contract.d.ts files for compile-time type inference.
 */

/**
 * Operation types for sqlite-vector extension.
 * Maps typeId to operation methods.
 */
export type OperationTypes = {
  readonly 'sqlite/vector@1': {
    readonly cosineDistance: {
      readonly args: readonly [
        {
          readonly kind: 'param';
        },
      ];
      readonly returns: {
        readonly kind: 'builtin';
        readonly type: 'number';
      };
      readonly lowering: {
        readonly targetFamily: 'sql';
        readonly strategy: 'function';
        readonly template: string;
      };
    };
  };
};
