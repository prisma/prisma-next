import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { extensionPacks } from './packs';

function extensionPackMetaFromDescriptor(descriptor: unknown): Record<string, unknown> {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return {};
  }
  const record = descriptor as Record<string, unknown>;
  const types = record['types'] as
    | undefined
    | {
        readonly codecTypes?: {
          readonly controlPlaneHooks?: unknown;
        };
      };
  return {
    kind: record['kind'],
    id: record['id'],
    familyId: record['familyId'],
    targetId: record['targetId'],
    version: record['version'],
    ...(record['capabilities'] ? { capabilities: record['capabilities'] } : {}),
    ...(types
      ? {
          types: {
            ...types,
            codecTypes: types.codecTypes
              ? { ...types.codecTypes, controlPlaneHooks: undefined }
              : undefined,
          },
        }
      : {}),
  };
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
  contract: prismaContract('./schema.prisma', {
    output: 'output/contract.json',
    composedExtensionPacks: extensionPacks.map((pack) => pack.id),
    ...(extensionPacks.length > 0
      ? {
          extensionPacks: extensionPacksMeta,
          capabilitySources: [postgresAdapter, ...Object.values(extensionPacksMeta)],
        }
      : {}),
  }),
});
