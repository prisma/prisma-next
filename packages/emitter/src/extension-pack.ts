import { join } from 'node:path';
import { readJsonFile } from '@prisma-next/node-utils';
import { type } from 'arktype';
import type { ExtensionPack, ExtensionPackManifest } from './types';

const TypesImportSpecSchema = type({
  package: 'string',
  named: 'string',
  alias: 'string',
});

const ArgSpecManifestSchema = type({
  kind: "'typeId' | 'param' | 'literal'",
  'type?': 'string',
});

const ReturnSpecManifestSchema = type({
  kind: "'typeId' | 'builtin'",
  'type?': 'string',
});

const LoweringSpecManifestSchema = type({
  targetFamily: "'sql'",
  strategy: "'infix' | 'function'",
  template: 'string',
});

const OperationManifestSchema = type({
  for: 'string',
  method: 'string',
  args: ArgSpecManifestSchema.array(),
  returns: ReturnSpecManifestSchema,
  lowering: LoweringSpecManifestSchema,
  'capabilities?': 'string[]',
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
  'operations?': OperationManifestSchema.array(),
});

export function loadExtensionPackManifest(packPath: string): ExtensionPackManifest {
  const manifestPath = join(packPath, 'packs', 'manifest.json');
  const manifestJson = readJsonFile<unknown>(manifestPath);

  const result = ExtensionPackManifestSchema(manifestJson);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid manifest structure at ${manifestPath}: ${messages}`);
  }

  return result as ExtensionPackManifest;
}

export function loadExtensionPacks(
  adapterPath?: string,
  extensionPackPaths: ReadonlyArray<string> = [],
): ReadonlyArray<ExtensionPack> {
  const packs: ExtensionPack[] = [];

  if (adapterPath) {
    const adapterManifest = loadExtensionPackManifest(adapterPath);
    packs.push({
      manifest: adapterManifest,
      path: adapterPath,
    });
  }

  for (const packPath of extensionPackPaths) {
    const packManifest = loadExtensionPackManifest(packPath);
    packs.push({
      manifest: packManifest,
      path: packPath,
    });
  }

  return packs;
}
