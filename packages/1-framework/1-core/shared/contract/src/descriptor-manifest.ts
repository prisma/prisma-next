import type { ComponentDescriptor } from './framework-components';
import type { ExtensionPackManifest } from './types';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = canonicalize(val);
      return acc;
    }, {});
  }

  return value;
}

export function serializeDescriptorToManifest(
  descriptor: ComponentDescriptor<string>,
): ExtensionPackManifest {
  return {
    id: descriptor.id,
    version: descriptor.version ?? descriptor.manifest.version,
    targets: descriptor.targets ?? descriptor.manifest.targets,
    capabilities: descriptor.capabilities ?? descriptor.manifest.capabilities,
    types: descriptor.types ?? descriptor.manifest.types,
    operations: descriptor.operations ?? descriptor.manifest.operations,
  };
}

export function assertManifestMatchesDescriptor(
  manifest: ExtensionPackManifest,
  descriptor: ComponentDescriptor<string>,
): void {
  const projected = serializeDescriptorToManifest(descriptor);
  const canonicalProjected = canonicalize(projected);
  const canonicalManifest = canonicalize(manifest);

  if (JSON.stringify(canonicalManifest) !== JSON.stringify(canonicalProjected)) {
    throw new Error(
      `Descriptor declarative fields are out of sync with manifest for "${descriptor.id}"`,
    );
  }
}
