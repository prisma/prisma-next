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
  if (typeof family['version'] !== 'string') {
    throw errorConfigValidation('family.version', {
      why: 'Config.family must have version: string',
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
  if (typeof target['version'] !== 'string') {
    throw errorConfigValidation('target.version', {
      why: 'Config.target must have version: string',
    });
  }
  if (target['familyId'] !== familyId) {
    throw errorConfigValidation('target.familyId', {
      why: `Config.target.familyId must match Config.family.familyId (expected: ${familyId}, got: ${target['familyId']})`,
    });
  }
  if (typeof target['targetId'] !== 'string') {
    throw errorConfigValidation('target.targetId', {
      why: 'Config.target must have targetId: string',
    });
  }
  if (typeof target['create'] !== 'function') {
    throw errorConfigValidation('target.create', {
      why: 'Config.target must have create: function',
    });
  }
  const expectedTargetId = target['targetId'] as string;

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
  if (typeof adapter['version'] !== 'string') {
    throw errorConfigValidation('adapter.version', {
      why: 'Config.adapter must have version: string',
    });
  }
  if (adapter['familyId'] !== familyId) {
    throw errorConfigValidation('adapter.familyId', {
      why: `Config.adapter.familyId must match Config.family.familyId (expected: ${familyId}, got: ${adapter['familyId']})`,
    });
  }
  if (typeof adapter['targetId'] !== 'string') {
    throw errorConfigValidation('adapter.targetId', {
      why: 'Config.adapter must have targetId: string',
    });
  }
  if (adapter['targetId'] !== expectedTargetId) {
    throw errorConfigValidation('adapter.targetId', {
      why: `Config.adapter.targetId must match Config.target.targetId (expected: ${expectedTargetId}, got: ${adapter['targetId']})`,
    });
  }
  if (typeof adapter['create'] !== 'function') {
    throw errorConfigValidation('adapter.create', {
      why: 'Config.adapter must have create: function',
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
      if (typeof extObj['version'] !== 'string') {
        throw errorConfigValidation('extensions[].version', {
          why: 'Config.extensions items must have version: string',
        });
      }
      if (extObj['familyId'] !== familyId) {
        throw errorConfigValidation('extensions[].familyId', {
          why: `Config.extensions[].familyId must match Config.family.familyId (expected: ${familyId}, got: ${extObj['familyId']})`,
        });
      }
      if (typeof extObj['targetId'] !== 'string') {
        throw errorConfigValidation('extensions[].targetId', {
          why: 'Config.extensions items must have targetId: string',
        });
      }
      if (extObj['targetId'] !== expectedTargetId) {
        throw errorConfigValidation('extensions[].targetId', {
          why: `Config.extensions[].targetId must match Config.target.targetId (expected: ${expectedTargetId}, got: ${extObj['targetId']})`,
        });
      }
      if (typeof extObj['create'] !== 'function') {
        throw errorConfigValidation('extensions[].create', {
          why: 'Config.extensions items must have create: function',
        });
      }
    }
  }

  // Validate driver descriptor if present
  if (configObj['driver'] !== undefined) {
    const driver = configObj['driver'] as Record<string, unknown>;
    if (driver['kind'] !== 'driver') {
      throw errorConfigValidation('driver.kind', {
        why: 'Config.driver must have kind: "driver"',
      });
    }
    if (typeof driver['id'] !== 'string') {
      throw errorConfigValidation('driver.id', {
        why: 'Config.driver must have id: string',
      });
    }
    if (typeof driver['version'] !== 'string') {
      throw errorConfigValidation('driver.version', {
        why: 'Config.driver must have version: string',
      });
    }
    if (typeof driver['familyId'] !== 'string') {
      throw errorConfigValidation('driver.familyId', {
        why: 'Config.driver must have familyId: string',
      });
    }
    if (driver['familyId'] !== familyId) {
      throw errorConfigValidation('driver.familyId', {
        why: `Config.driver.familyId must match Config.family.familyId (expected: ${familyId}, got: ${driver['familyId']})`,
      });
    }
    if (typeof driver['targetId'] !== 'string') {
      throw errorConfigValidation('driver.targetId', {
        why: 'Config.driver must have targetId: string',
      });
    }
    if (driver['targetId'] !== expectedTargetId) {
      throw errorConfigValidation('driver.targetId', {
        why: `Config.driver.targetId must match Config.target.targetId (expected: ${expectedTargetId}, got: ${driver['targetId']})`,
      });
    }
    if (typeof driver['create'] !== 'function') {
      throw errorConfigValidation('driver.create', {
        why: 'Config.driver must have create: function',
      });
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

    if (typeof contract['source'] !== 'function') {
      throw errorConfigValidation('contract.source', {
        why: 'Config.contract.source must be a provider function',
      });
    }

    if (contract['output'] !== undefined && typeof contract['output'] !== 'string') {
      throw errorConfigValidation('contract.output', {
        why: 'Config.contract.output must be a string when provided',
      });
    }
  }
}
