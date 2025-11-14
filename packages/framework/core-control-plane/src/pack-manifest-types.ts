import type { TypesImportSpec } from '@prisma-next/emitter';

export type ArgSpecManifest =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'param' }
  | { readonly kind: 'literal' };

export type ReturnSpecManifest =
  | { readonly kind: 'typeId'; readonly type: string }
  | { readonly kind: 'builtin'; readonly type: 'number' | 'boolean' | 'string' };

export interface LoweringSpecManifest {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface OperationManifest {
  readonly for: string;
  readonly method: string;
  readonly args: ReadonlyArray<ArgSpecManifest>;
  readonly returns: ReturnSpecManifest;
  readonly lowering: LoweringSpecManifest;
  readonly capabilities?: ReadonlyArray<string>;
}

export interface ExtensionPackManifest {
  readonly id: string;
  readonly version: string;
  readonly targets?: Record<string, { readonly minVersion?: string }>;
  readonly capabilities?: Record<string, unknown>;
  readonly types?: {
    readonly codecTypes?: {
      readonly import: TypesImportSpec;
    };
    readonly operationTypes?: {
      readonly import: TypesImportSpec;
    };
  };
  readonly operations?: ReadonlyArray<OperationManifest>;
}

export interface ExtensionPack {
  readonly manifest: ExtensionPackManifest;
  readonly path: string;
}

