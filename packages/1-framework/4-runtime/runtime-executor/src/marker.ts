import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { type } from 'arktype';

export interface ContractMarkerRow {
  core_hash: string;
  profile_hash: string;
  contract_json: unknown | null;
  canonical_version: number | null;
  updated_at: Date;
  app_tag: string | null;
  meta: unknown | null;
  invariants: readonly string[] | null;
}

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
  'invariants?': type('string').array().or('null'),
});

export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const updatedAt = result.updated_at
    ? result.updated_at instanceof Date
      ? result.updated_at
      : new Date(result.updated_at)
    : new Date();

  return {
    storageHash: result.core_hash,
    profileHash: result.profile_hash,
    contractJson: result.contract_json ?? null,
    canonicalVersion: result.canonical_version ?? null,
    updatedAt,
    appTag: result.app_tag ?? null,
    meta: parseMeta(result.meta),
    invariants: result.invariants ?? [],
  };
}
