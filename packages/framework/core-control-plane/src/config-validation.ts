import type { PrismaNextConfig } from './config-types';
import { errorConfigValidation } from './errors';

/**
 * Validates that the config has the required structure.
 * This is pure validation logic with no file I/O or CLI awareness.
 *
 * @param config - Config object to validate
 * @throws CliStructuredError if config structure is invalid
 */
export function validateConfig(config: unknown): asserts config is PrismaNextConfig {
  if (!config || typeof config !== 'object') {
    throw errorConfigValidation('object', {
      why: 'Config must be an object',
    });
  }

  const configObj = config as Record<string, unknown>;

  if (!configObj['family']) {
    throw errorConfigValidation('family');
  }

  if (!configObj['target']) {
    throw errorConfigValidation('target');
  }

  if (!configObj['adapter']) {
    throw errorConfigValidation('adapter');
  }

  // Validate family descriptor
  const family = configObj['family'] as Record<string, unknown>;
  if (family['kind'] !== 'family') {
    throw errorConfigValidation('family.kind', {
      why: 'Config.family must have kind: "family"',
    });
  }
  if (typeof family['familyId'] !== 'string') {
    throw errorConfigValidation('family.familyId', {
      why: 'Config.family must have familyId: string',
    });
  }
  if (!family['manifest'] || typeof family['manifest'] !== 'object') {
    throw errorConfigValidation('family.manifest', {
      why: 'Config.family must have manifest: ExtensionPackManifest',
    });
  }
  if (!family['hook'] || typeof family['hook'] !== 'object') {
    throw errorConfigValidation('family.hook', {
      why: 'Config.family must have hook: TargetFamilyHook',
    });
  }
  if (typeof family['create'] !== 'function') {
    throw errorConfigValidation('family.create', {
      why: 'Config.family must have create: function',
    });
  }

  const familyId = family['familyId'] as string;

  // Validate target descriptor
  const target = configObj['target'] as Record<string, unknown>;
  if (target['kind'] !== 'target') {
    throw errorConfigValidation('target.kind', {
      why: 'Config.target must have kind: "target"',
    });
  }
  if (typeof target['id'] !== 'string') {
    throw errorConfigValidation('target.id', {
      why: 'Config.target must have id: string',
    });
  }
  if (typeof target['familyId'] !== 'string') {
    throw errorConfigValidation('target.familyId', {
      why: 'Config.target must have familyId: string',
    });
  }
  if (!target['manifest'] || typeof target['manifest'] !== 'object') {
    throw errorConfigValidation('target.manifest', {
      why: 'Config.target must have manifest: ExtensionPackManifest',
    });
  }
  if (target['familyId'] !== familyId) {
    throw errorConfigValidation('target.familyId', {
      why: `Config.target.familyId must match Config.family.familyId (expected: ${familyId}, got: ${target['familyId']})`,
    });
  }

  // Validate adapter descriptor
  const adapter = configObj['adapter'] as Record<string, unknown>;
  if (adapter['kind'] !== 'adapter') {
    throw errorConfigValidation('adapter.kind', {
      why: 'Config.adapter must have kind: "adapter"',
    });
  }
  if (typeof adapter['id'] !== 'string') {
    throw errorConfigValidation('adapter.id', {
      why: 'Config.adapter must have id: string',
    });
  }
  if (typeof adapter['familyId'] !== 'string') {
    throw errorConfigValidation('adapter.familyId', {
      why: 'Config.adapter must have familyId: string',
    });
  }
  if (!adapter['manifest'] || typeof adapter['manifest'] !== 'object') {
    throw errorConfigValidation('adapter.manifest', {
      why: 'Config.adapter must have manifest: ExtensionPackManifest',
    });
  }
  if (adapter['familyId'] !== familyId) {
    throw errorConfigValidation('adapter.familyId', {
      why: `Config.adapter.familyId must match Config.family.familyId (expected: ${familyId}, got: ${adapter['familyId']})`,
    });
  }

  // Validate extensions array if present
  if (configObj['extensions'] !== undefined) {
    if (!Array.isArray(configObj['extensions'])) {
      throw errorConfigValidation('extensions', {
        why: 'Config.extensions must be an array',
      });
    }
    for (const ext of configObj['extensions']) {
      if (!ext || typeof ext !== 'object') {
        throw errorConfigValidation('extensions[]', {
          why: 'Config.extensions must contain ExtensionDescriptor objects',
        });
      }
      const extObj = ext as Record<string, unknown>;
      if (extObj['kind'] !== 'extension') {
        throw errorConfigValidation('extensions[].kind', {
          why: 'Config.extensions items must have kind: "extension"',
        });
      }
      if (typeof extObj['id'] !== 'string') {
        throw errorConfigValidation('extensions[].id', {
          why: 'Config.extensions items must have id: string',
        });
      }
      if (typeof extObj['familyId'] !== 'string') {
        throw errorConfigValidation('extensions[].familyId', {
          why: 'Config.extensions items must have familyId: string',
        });
      }
      if (!extObj['manifest'] || typeof extObj['manifest'] !== 'object') {
        throw errorConfigValidation('extensions[].manifest', {
          why: 'Config.extensions items must have manifest: ExtensionPackManifest',
        });
      }
      if (extObj['familyId'] !== familyId) {
        throw errorConfigValidation('extensions[].familyId', {
          why: `Config.extensions[].familyId must match Config.family.familyId (expected: ${familyId}, got: ${extObj['familyId']})`,
        });
      }
    }
  }

  // Validate contract config if present (structure validation - defineConfig() handles normalization)
  if (configObj['contract'] !== undefined) {
    const contract = configObj['contract'] as Record<string, unknown>;
    if (!contract || typeof contract !== 'object') {
      throw errorConfigValidation('contract', {
        why: 'Config.contract must be an object',
      });
    }
    if (!('source' in contract)) {
      throw errorConfigValidation('contract.source', {
        why: 'Config.contract.source is required when contract is provided',
      });
    }
    if (contract['output'] !== undefined && typeof contract['output'] !== 'string') {
      throw errorConfigValidation('contract.output', {
        why: 'Config.contract.output must be a string when provided',
      });
    }
    if (contract['types'] !== undefined && typeof contract['types'] !== 'string') {
      throw errorConfigValidation('contract.types', {
        why: 'Config.contract.types must be a string when provided',
      });
    }
  }
}
