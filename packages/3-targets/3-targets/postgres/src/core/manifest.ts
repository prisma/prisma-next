import type { ExtensionPackManifest } from '@prisma-next/contract/pack-manifest-types';
import { type } from 'arktype';
import manifestJson from '../../packs/manifest.json' with { type: 'json' };

const ExtensionPackManifestSchema = type({
  id: 'string',
  version: 'string',
  'targets?': type({ '[string]': type({ 'minVersion?': 'string' }) }),
  'capabilities?': 'Record<string, unknown>',
});

function validateManifest(): ExtensionPackManifest {
  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid target manifest structure: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

export const manifest = validateManifest();
