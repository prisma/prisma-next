import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';

type CapabilityMatrix = Record<string, Record<string, boolean>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePlainObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = next[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      next[key] = mergePlainObjects(existing, value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const next: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    next[key] = sortDeep(child);
  }
  return next;
}

function sortDeepTyped<T>(value: T): T {
  return sortDeep(value) as T;
}

function extractCapabilityMatrix(value: unknown): CapabilityMatrix {
  if (!isPlainObject(value)) return {};

  const out: CapabilityMatrix = {};
  for (const [namespace, maybeCaps] of Object.entries(value)) {
    if (!isPlainObject(maybeCaps)) continue;
    const caps: Record<string, boolean> = {};
    for (const [key, flag] of Object.entries(maybeCaps)) {
      if (typeof flag === 'boolean') {
        caps[key] = flag;
      }
    }
    if (Object.keys(caps).length > 0) {
      out[namespace] = caps;
    }
  }

  return out;
}

function mergeCapabilities(left: CapabilityMatrix, right: CapabilityMatrix): CapabilityMatrix {
  const next: CapabilityMatrix = { ...left };
  for (const [namespace, capabilities] of Object.entries(right)) {
    next[namespace] = {
      ...(left[namespace] ?? {}),
      ...capabilities,
    };
  }
  return next;
}

function extractExtensionPackMeta(
  component: TargetBoundComponentDescriptor<string, string>,
): Record<string, unknown> {
  const { kind, id, version, capabilities, types } = component;
  const base: Record<string, unknown> = {
    kind,
    id,
    familyId: component.familyId,
    targetId: component.targetId,
    version,
  };
  if (capabilities) {
    base['capabilities'] = capabilities;
  }
  if (types) {
    if (types.codecTypes) {
      const { controlPlaneHooks: _, ...cleanedCodecTypes } = types.codecTypes;
      base['types'] = { ...types, codecTypes: cleanedCodecTypes };
    } else {
      base['types'] = types;
    }
  }
  return base;
}

/**
 * Enriches a raw contract IR with framework-derived metadata:
 * capabilities from all component descriptors and extension pack metadata
 * from extension descriptors. Produces deterministically sorted output.
 */
export function enrichContractIR(
  ir: ContractIR,
  components: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>,
): ContractIR {
  let mergedCapabilities = ir.capabilities;
  const extensionPacksMeta: Record<string, unknown> = {};

  for (const component of components) {
    if (component.capabilities) {
      mergedCapabilities = mergeCapabilities(
        mergedCapabilities,
        extractCapabilityMatrix(component.capabilities),
      );
    }
    if (component.kind === 'extension') {
      extensionPacksMeta[component.id] = extractExtensionPackMeta(component);
    }
  }

  const extensionPacks =
    Object.keys(extensionPacksMeta).length > 0
      ? mergePlainObjects(ir.extensionPacks, extensionPacksMeta)
      : ir.extensionPacks;

  return {
    ...ir,
    capabilities: sortDeepTyped(mergedCapabilities),
    extensionPacks: sortDeepTyped(extensionPacks),
  };
}
