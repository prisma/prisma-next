export interface TypesImportSpec {
  readonly package: string;
  readonly named: string;
  readonly alias: string;
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
    readonly canonicalScalarMap?: Record<string, string>;
  };
}

export interface ExtensionPack {
  readonly manifest: ExtensionPackManifest;
  readonly path: string;
}

export interface ContractIR {
  readonly schemaVersion?: string;
  readonly targetFamily: string;
  readonly target: string;
  readonly models?: Record<string, unknown>;
  readonly relations?: Record<string, unknown>;
  readonly storage?: Record<string, unknown>;
  readonly extensions?: Record<string, unknown>;
  readonly capabilities?: Record<string, Record<string, boolean>>;
  readonly meta?: Record<string, unknown>;
  readonly sources?: Record<string, unknown>;
}

export interface EmitOptions {
  readonly outputDir: string;
  readonly packs: ReadonlyArray<ExtensionPack>;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly coreHash: string;
  readonly profileHash?: string;
}
