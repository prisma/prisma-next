import { targetFamilyRegistry } from './target-family-registry';
import { loadExtensionPacks } from './extension-pack';
import { computeCoreHash, computeProfileHash } from './hashing';
import type { ContractIR, EmitOptions, EmitResult } from './types';

function validateCoreStructure(ir: ContractIR): void {
  if (!ir.targetFamily) {
    throw new Error('ContractIR must have targetFamily');
  }
  if (!ir.target) {
    throw new Error('ContractIR must have target');
  }
}

function validateExtensions(ir: ContractIR, adapterId: string | undefined): void {
  const extensions = ir.extensions as Record<string, unknown> | undefined;
  if (!extensions) {
    return;
  }

  if (adapterId && !extensions[adapterId]) {
    throw new Error(
      `Adapter "${adapterId}" (identified by contract.target "${ir.target}") must appear as first extension in contract.extensions.${adapterId}`,
    );
  }
}

export async function emit(ir: ContractIR, options: EmitOptions): Promise<EmitResult> {
  const { adapterPath, extensionPackPaths = [] } = options;

  const packs = loadExtensionPacks(adapterPath, extensionPackPaths);
  const packManifests = packs.map((p) => p.manifest);

  const hook = targetFamilyRegistry.require(ir.targetFamily);

  validateCoreStructure(ir);

  hook.validateTypes(ir, packManifests);

  hook.validateStructure(ir);

  validateExtensions(ir, adapterPath ? packs[0]?.manifest.id : undefined);

  const contractJson = {
    schemaVersion: ir.schemaVersion || '1',
    targetFamily: ir.targetFamily,
    target: ir.target,
    models: ir.models || {},
    relations: ir.relations || {},
    storage: ir.storage || {},
    extensions: ir.extensions || {},
    capabilities: ir.capabilities || {},
    meta: ir.meta || {},
    sources: ir.sources || {},
  } as const;

  const coreHash = computeCoreHash(contractJson);
  const profileHash = computeProfileHash(contractJson);

  const contractWithHashes = {
    ...contractJson,
    coreHash,
    ...(profileHash ? { profileHash } : {}),
  };

  const contractDts = hook.generateContractTypes(ir, packs);

  const contractJsonString = JSON.stringify(contractWithHashes, null, 2) + '\n';

  return {
    contractJson: contractJsonString,
    contractDts,
    coreHash,
    profileHash,
  };
}
