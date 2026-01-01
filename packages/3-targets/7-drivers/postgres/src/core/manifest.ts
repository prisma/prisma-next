import type { ExtensionPackManifest } from '@prisma-next/contract/pack-manifest-types';
import { type } from 'arktype';
import manifestJson from '../../packs/manifest.json' with { type: 'json' };

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const ExtensionPackManifestSchema = type({
  id: 'string',
  version: 'string',
  'targets?': type({ '[string]': type({ 'minVersion?': 'string' }) }),
  'capabilities?': 'Record<string, unknown>',
  'types?': type({
    'codecTypes?': type({
      import: TypesImportSpecSchema,
    }),
    'operationTypes?': type({
      import: TypesImportSpecSchema,
    }),
  }),
  'operations?': 'unknown[]',
});

function validateManifest(): ExtensionPackManifest {
  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid driver manifest structure: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

export const manifest = validateManifest();
