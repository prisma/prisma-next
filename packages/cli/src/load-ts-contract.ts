import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ContractIR } from '@prisma-next/emitter';

export interface LoadTsContractOptions {
  readonly allowlist?: ReadonlyArray<string>;
}

const DEFAULT_ALLOWLIST = ['@prisma-next/*'];

function isAllowedImport(importPath: string, allowlist: ReadonlyArray<string>): boolean {
  for (const pattern of allowlist) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (importPath === prefix || importPath.startsWith(prefix + '/')) {
        return true;
      }
    } else if (importPath === pattern) {
      return true;
    }
  }
  return false;
}

function validatePurity(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  const seen = new WeakSet();
  function check(value: unknown): void {
    if (value === null || typeof value !== 'object') {
      return;
    }

    if (seen.has(value)) {
      throw new Error('Contract export contains circular references');
    }
    seen.add(value);

    for (const key in value) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && (descriptor.get || descriptor.set)) {
        throw new Error(`Contract export contains getter/setter at key "${key}"`);
      }
      if (descriptor && typeof descriptor.value === 'function') {
        throw new Error(`Contract export contains function at key "${key}"`);
      }
      check((value as Record<string, unknown>)[key]);
    }
  }

  try {
    check(value);
    JSON.stringify(value);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('getter') || error.message.includes('circular')) {
        throw error;
      }
      throw new Error(`Contract export is not JSON-serializable: ${error.message}`);
    }
    throw new Error('Contract export is not JSON-serializable');
  }
}

function createImportAllowlistPlugin(allowlist: ReadonlyArray<string>, entryPath: string): Plugin {
  return {
    name: 'import-allowlist',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return undefined;
        }
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          return undefined;
        }
        const isFromEntryPoint = args.importer === entryPath || args.importer === '<stdin>';
        if (isFromEntryPoint && !isAllowedImport(args.path, allowlist)) {
          return {
            path: args.path,
            external: true,
          };
        }
        return undefined;
      });
    },
  };
}

export async function loadContractFromTs(
  entryPath: string,
  options?: LoadTsContractOptions,
): Promise<ContractIR> {
  const allowlist = options?.allowlist ?? DEFAULT_ALLOWLIST;

  const tempFile = join(tmpdir(), `prisma-next-contract-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);

  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      outfile: tempFile,
      write: false,
      metafile: true,
      plugins: [createImportAllowlistPlugin(allowlist, entryPath)],
      logLevel: 'error',
    });

    if (result.errors.length > 0) {
      const errorMessages = result.errors.map((e: { text: string }) => e.text).join('\n');
      throw new Error(`Failed to bundle contract file: ${errorMessages}`);
    }

    if (!result.outputFiles || result.outputFiles.length === 0) {
      throw new Error('No output files generated from bundling');
    }

    const disallowedImports: string[] = [];
    if (result.metafile) {
      const inputs = result.metafile.inputs;
      for (const [, inputData] of Object.entries(inputs)) {
        const imports = (inputData as { imports?: Array<{ path: string; external?: boolean }> }).imports || [];
        for (const imp of imports) {
          if (imp.external && !imp.path.startsWith('.') && !imp.path.startsWith('/') && !isAllowedImport(imp.path, allowlist)) {
            disallowedImports.push(imp.path);
          }
        }
      }
    }

    if (disallowedImports.length > 0) {
      throw new Error(
        `Disallowed imports detected. Only imports matching the allowlist are permitted:\n` +
          `  Allowlist: ${allowlist.join(', ')}\n` +
          `  Disallowed imports: ${disallowedImports.join(', ')}\n` +
          `\nOnly @prisma-next/* packages are allowed in contract files.`,
      );
    }

    const bundleContent = result.outputFiles[0]!.text;
    writeFileSync(tempFile, bundleContent, 'utf-8');

    const module = await import(`file://${tempFile}`);
    unlinkSync(tempFile);

    let contract: unknown;

    if (module.default !== undefined) {
      contract = module.default;
    } else if (module.contract !== undefined) {
      contract = module.contract;
    } else {
      throw new Error(
        `Contract file must export a contract as default export or named export 'contract'. ` +
          `Found exports: ${Object.keys(module).join(', ') || 'none'}`,
      );
    }

    if (typeof contract !== 'object' || contract === null) {
      throw new Error(`Contract export must be an object, got ${typeof contract}`);
    }

    validatePurity(contract);

    return contract as ContractIR;
  } catch (error) {
    try {
      if (tempFile) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load contract from ${entryPath}: ${String(error)}`);
  }
}

