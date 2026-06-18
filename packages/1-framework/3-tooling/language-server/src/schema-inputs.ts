import { pathToFileURL } from 'node:url';

// Declared narrowly (not the full `PrismaNextConfig`) so membership logic stays
// testable and uncoupled from descriptor shapes; a resolved config is
// structurally assignable to it.
export interface SchemaInputConfig {
  readonly contract?: {
    readonly source: {
      readonly inputs?: readonly string[];
    };
  };
}

export interface SchemaInputSet {
  includes(uri: string): boolean;
}

// `inputs` are absolute paths after the config loader finalizes them; converting
// to `file:` URIs lets membership compare against the URIs LSP documents carry.
export function resolveSchemaInputs(config: SchemaInputConfig): SchemaInputSet {
  const source = config.contract?.source;
  const uris = source?.inputs
    ? new Set(source.inputs.map((input) => pathToFileURL(input).toString()))
    : new Set<string>();

  return {
    includes: (uri) => uris.has(uri),
  };
}

export const emptySchemaInputSet: SchemaInputSet = {
  includes: () => false,
};
