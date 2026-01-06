import { defineConfig as defineConfigOriginal, type UserConfig } from 'tsdown';

/**
 * Extend/use the base `tsdown` config with custom settings.
 *
 * See {@link baseConfig} for the default configuration object we use.
 */
export function defineConfig(config?: UserConfig): UserConfig {
  return {
    ...baseConfig,
    ...config,
  };
}

/**
 * Base `tsdown` configuration for the monorepo.
 *
 * You can import and extend this configuration in your package-specific `tsdown.config.ts` files.
 *
 * If you're not doing anything with arrays or functions, opt for {@link defineConfig} instead.
 */
export const baseConfig = defineConfigOriginal({
  dts: {
    enabled: true,
    sourcemap: true,
  },
  exports: {
    customExports: function removeExportsPrefixes(exports) {
      // biome-ignore lint/suspicious/noExplicitAny: it's fine.
      const out: Record<string, any> = {};

      for (let [key, value] of Object.entries(exports)) {
        // omit "exports/" prefixes from the output paths
        key = key.replace(/exports\/?/, '');

        // './' is illegal in package.json exports, replace with '.'
        if (key === './') {
          key = '.';
        }

        out[key] = value;
      }

      return out;
    },
    devExports: true,
    enabled: 'local-only',
    // cli files should not be importable by consumers.
    exclude: [/cli\./],
  },
  // override per-package if you want to bundle dev or phantom dependencies.
  skipNodeModulesBundle: true,
  sourcemap: true,
});
