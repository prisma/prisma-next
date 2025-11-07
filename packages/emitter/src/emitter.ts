import { format } from 'prettier';
import { canonicalizeContract } from './canonicalization';
import { computeCoreHash, computeProfileHash } from './hashing';
import type { TargetFamilyHook } from './target-family';
import type { ContractIR, EmitOptions, EmitResult, ExtensionPack } from './types';

function validateCoreStructure(ir: ContractIR): void {
  if (!ir.targetFamily) {
    throw new Error('ContractIR must have targetFamily');
  }
  if (!ir.target) {
    throw new Error('ContractIR must have target');
  }
}

function validateExtensions(ir: ContractIR, packs: ReadonlyArray<ExtensionPack>): void {
  const extensions = ir.extensions as Record<string, unknown> | undefined;
  if (!extensions) {
    return;
  }

  for (const pack of packs) {
    const packId = pack.manifest.id;
    if (!extensions[packId]) {
      throw new Error(
        `Extension pack "${packId}" (loaded from manifest) must appear in contract.extensions.${packId}`,
      );
    }
  }
}

export async function emit(
  ir: ContractIR,
  options: EmitOptions,
  targetFamily: TargetFamilyHook,
): Promise<EmitResult> {
  const { packs } = options;

  const packManifests = packs.map((p) => p.manifest);

  validateCoreStructure(ir);

  targetFamily.validateTypes(ir, packManifests);

  targetFamily.validateStructure(ir);

  validateExtensions(ir, packs);

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

  const contractWithHashes: ContractIR & { coreHash?: string; profileHash?: string } = {
    ...ir,
    schemaVersion: contractJson.schemaVersion,
    coreHash,
    ...(profileHash ? { profileHash } : {}),
  };

  const contractJsonString = canonicalizeContract(contractWithHashes);

  const contractDtsRaw = targetFamily.generateContractTypes(ir, packs);
  const contractDts = await format(contractDtsRaw, {
    parser: 'typescript',
    singleQuote: true,
    semi: true,
    printWidth: 100,
  });

  return {
    contractJson: contractJsonString,
    contractDts,
    coreHash,
    profileHash,
  };
}
