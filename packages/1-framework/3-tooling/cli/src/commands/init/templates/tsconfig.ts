export const REQUIRED_COMPILER_OPTIONS: Record<string, string | boolean> = {
  module: 'preserve',
  moduleResolution: 'bundler',
  resolveJsonModule: true,
};

export function defaultTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        ...REQUIRED_COMPILER_OPTIONS,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        outDir: 'dist',
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  );
}

export function mergeTsConfig(existing: string): string {
  const config = JSON.parse(existing) as Record<string, unknown>;
  const compilerOptions = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    compilerOptions[key] = value;
  }

  config['compilerOptions'] = compilerOptions;
  return JSON.stringify(config, null, 2);
}
