import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { ok } from '@prisma-next/utils/result';
import { contract } from './contract';
import { extensionPacks } from './packs';

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

function extensionPackMetaFromDescriptor(descriptor: unknown): Record<string, unknown> {
  if (!isPlainObject(descriptor)) {
    return {};
  }
  return {
    kind: descriptor['kind'],
    id: descriptor['id'],
    familyId: descriptor['familyId'],
    targetId: descriptor['targetId'],
    version: descriptor['version'],
    ...(descriptor['capabilities'] ? { capabilities: descriptor['capabilities'] } : {}),
    ...(descriptor['types'] ? { types: descriptor['types'] } : {}),
  };
}

function mergeCapabilitiesFromSources(sources: readonly unknown[]): Record<string, unknown> {
  let merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    const caps = source['capabilities'];
    if (!isPlainObject(caps)) continue;
    merged = mergePlainObjects(merged, caps);
  }
  return merged;
}

const extensionPacksMeta = Object.fromEntries(
  extensionPacks.map((pack) => [pack.id, extensionPackMetaFromDescriptor(pack)]),
);

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks,
  contract:
    extensionPacks.length > 0
      ? (() => {
          const base = typescriptContract(contract, 'output/contract.json');

          return {
            ...base,
            source: async () => {
              const result = await base.source();
              if (!result.ok) return result;

              const mergedCapabilities = mergePlainObjects(
                (result.value as { readonly capabilities?: Record<string, unknown> })
                  .capabilities ?? {},
                mergeCapabilitiesFromSources([
                  postgresAdapter,
                  ...Object.values(extensionPacksMeta),
                ]),
              );

              return ok({
                ...result.value,
                extensionPacks: extensionPacksMeta,
                capabilities: mergedCapabilities,
              });
            },
          };
        })()
      : typescriptContract(contract, 'output/contract.json'),
});
