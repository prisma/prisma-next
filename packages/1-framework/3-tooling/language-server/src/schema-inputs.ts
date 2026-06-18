import { pathToFileURL } from 'node:url';

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
