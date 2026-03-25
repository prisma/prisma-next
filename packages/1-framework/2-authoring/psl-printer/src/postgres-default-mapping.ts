import type { DefaultMappingOptions } from './default-mapping';

const POSTGRES_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'gen_random_uuid()': '@default(dbgenerated("gen_random_uuid()"))',
};

export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    functionAttributes: POSTGRES_FUNCTION_ATTRIBUTES,
  };
}
