import { name, version } from '../package.json';
import { lintBuildCall } from './rules/lint-build-call';

// Plugin metadata
const PLUGIN_META = {
  name,
  version,
};

// Rule definitions
const RULES = {
  'lint-build-call': lintBuildCall,
};

// Configuration presets
const RULE_CONFIG = {
  '@prisma-next/lint-build-call': 'error',
};

// Plugin interface
interface ESLintPlugin {
  meta: {
    name: string;
    version: string;
  };
  // biome-ignore lint/suspicious/noExplicitAny: Required for ESLint plugin interface compatibility
  rules: Record<string, any>;
  // biome-ignore lint/suspicious/noExplicitAny: Required for ESLint plugin interface compatibility
  configs: Record<string, any>;
}

// Plugin implementation
const plugin: ESLintPlugin = {
  meta: PLUGIN_META,
  rules: RULES,
  configs: {
    recommended: {
      plugins: ['@prisma-next'],
      rules: RULE_CONFIG,
    },
  },
};

// Add flat config after plugin is defined to avoid circular reference
plugin.configs['flat/recommended'] = {
  plugins: {
    '@prisma-next': plugin,
  },
  rules: RULE_CONFIG,
};

// Exports
export default plugin;
export { lintBuildCall };
export { plugin };
export type { ESLintPlugin };
