import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { targetFamilyRegistry } from './target-family-registry';
import { loadExtensionPacks } from './extension-pack';
import { computeCoreHash, computeProfileHash } from './hashing';
import type { ContractIR, EmitOptions, EmitResult } from './types';
import type { TargetFamilyHook } from './target-family';

function canonicalizeStorageTypes(
  ir: ContractIR,
  hook: TargetFamilyHook,
  packManifests: ReadonlyArray<{ types?: { canonicalScalarMap?: Record<string, string> } }>,
): ContractIR {
  if (!ir.storage || typeof ir.storage !== 'object') {
    return ir;
  }

  const storage = ir.storage as Record<string, Record<string, { type?: string; nullable?: boolean }>>;

  if (!storage.tables) {
    return ir;
  }

  const canonicalizedStorage = { ...storage };
  const canonicalizedTables: Record<string, Record<string, { type?: string; nullable?: boolean }>> = {};

  for (const [tableName, table] of Object.entries(storage.tables)) {
    if (!table.columns) {
      canonicalizedTables[tableName] = table;
      continue;
    }

    const canonicalizedColumns: Record<string, { type?: string; nullable?: boolean }> = {};
    for (const [colName, col] of Object.entries(table.columns)) {
      if (col.type) {
        const canonicalizedType = hook.canonicalizeType(col.type, packManifests);
        canonicalizedColumns[colName] = {
          ...col,
          type: canonicalizedType,
        };
      } else {
        canonicalizedColumns[colName] = col;
      }
    }

    canonicalizedTables[tableName] = {
      ...table,
      columns: canonicalizedColumns,
    };
  }

  canonicalizedStorage.tables = canonicalizedTables;

  return {
    ...ir,
    storage: canonicalizedStorage,
  };
}

function validateCoreStructure(ir: ContractIR): void {
  if (!ir.targetFamily) {
    throw new Error('ContractIR must have targetFamily');
  }
  if (!ir.target) {
    throw new Error('ContractIR must have target');
  }
}

export async function emit(ir: ContractIR, options: EmitOptions): Promise<EmitResult> {
  const {
    outputDir,
    adapterPath,
    extensionPackPaths = [],
    writeFiles = true,
  } = options;

  const packs = loadExtensionPacks(adapterPath, extensionPackPaths);
  const packManifests = packs.map((p) => p.manifest);

  const hook = targetFamilyRegistry.require(ir.targetFamily);

  validateCoreStructure(ir);

  const canonicalizedIr = canonicalizeStorageTypes(ir, hook, packManifests);

  hook.validateStructure(canonicalizedIr);

  const contractJson = {
    schemaVersion: canonicalizedIr.schemaVersion || '1',
    targetFamily: canonicalizedIr.targetFamily,
    target: canonicalizedIr.target,
    models: canonicalizedIr.models || {},
    relations: canonicalizedIr.relations || {},
    storage: canonicalizedIr.storage || {},
    extensions: canonicalizedIr.extensions || {},
    capabilities: canonicalizedIr.capabilities || {},
    meta: canonicalizedIr.meta || {},
    sources: canonicalizedIr.sources || {},
  } as const;

  const coreHash = computeCoreHash(contractJson);
  const profileHash = computeProfileHash(contractJson);

  const contractWithHashes = {
    ...contractJson,
    coreHash,
    ...(profileHash ? { profileHash } : {}),
  };

  const contractDts = hook.generateContractTypes(canonicalizedIr, packs);

  if (writeFiles) {
    await mkdir(outputDir, { recursive: true });
    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    await writeFile(contractJsonPath, JSON.stringify(contractWithHashes, null, 2) + '\n', 'utf-8');
    await writeFile(contractDtsPath, contractDts, 'utf-8');
  }

  return {
    contractJson: contractWithHashes,
    contractDts,
    coreHash,
    profileHash,
  };
}

