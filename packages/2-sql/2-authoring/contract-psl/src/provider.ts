import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@prisma-next/config/config-types';
import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { resolve } from 'pathe';
import { createBuiltinDefaultFunctionRegistry } from './default-function-registry';
import { interpretPslDocumentToSqlContractIR } from './interpreter';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePlainObjects(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = next[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      next[key] = mergePlainObjects(existing, value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const next: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    next[key] = sortDeep(child);
  }
  return next;
}

function mergeCapabilitiesFromSources(
  sources: readonly unknown[] | undefined,
): Record<string, unknown> {
  if (!sources || sources.length === 0) {
    return {};
  }

  let merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    const caps = source['capabilities'];
    if (!isPlainObject(caps)) continue;
    merged = mergePlainObjects(merged, caps);
  }
  return merged;
}

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target?: TargetPackRef<'sql', 'postgres'>;
  /**
   * Milestone-local namespace availability hook.
   *
   * This currently models composed extension packs by id only (for example `["pgvector"]`),
   * and is sufficient for namespace presence checks in the PSL interpreter.
   *
   * Future milestones can evolve this to richer composed pack metadata/manifests when
   * attribute-level schema/argument validation needs to move beyond namespace existence.
   */
  readonly composedExtensionPacks?: readonly string[];

  /**
   * JSON-safe extension pack metadata emitted into `contract.extensionPacks`.
   *
   * Prefer passing pack metadata exports (for example `@prisma-next/extension-pgvector/pack`)
   * rather than control/runtime descriptors, so the emitted contract remains serializable.
   */
  readonly extensionPacks?: Record<string, unknown>;

  /**
   * Sources of capabilities to merge into `contract.capabilities`.
   *
   * When set, the provider will merge all available capabilities and emit them deterministically.
   * Sources are expected to expose a `capabilities` object (for example descriptor meta objects).
   */
  readonly capabilitySources?: readonly unknown[];
}

export function prismaContract(
  schemaPath: string,
  options?: PrismaContractOptions,
): ContractConfig {
  return {
    source: async () => {
      const absoluteSchemaPath = resolve(schemaPath);
      let schema: string;
      try {
        schema = await readFile(absoluteSchemaPath, 'utf-8');
      } catch (error) {
        const message = String(error);
        return notOk({
          summary: `Failed to read Prisma schema at "${schemaPath}"`,
          diagnostics: [
            {
              code: 'PSL_SCHEMA_READ_FAILED',
              message,
              sourceId: schemaPath,
            },
          ],
          meta: { schemaPath, absoluteSchemaPath, cause: message },
        });
      }

      const document = parsePslDocument({
        schema,
        sourceId: schemaPath,
      });

      const interpreted = interpretPslDocumentToSqlContractIR({
        document,
        ...ifDefined('target', options?.target),
        ...ifDefined('composedExtensionPacks', options?.composedExtensionPacks),
        defaultFunctionRegistry: createBuiltinDefaultFunctionRegistry(),
      });
      if (!interpreted.ok) {
        return interpreted;
      }

      const base = interpreted.value as unknown as {
        readonly capabilities?: Record<string, unknown> | undefined;
        readonly extensionPacks?: Record<string, unknown> | undefined;
      };

      const extensionPacks = options?.extensionPacks
        ? mergePlainObjects(base.extensionPacks ?? {}, options.extensionPacks)
        : (base.extensionPacks ?? {});

      const mergedCapabilities = mergePlainObjects(
        base.capabilities ?? {},
        mergeCapabilitiesFromSources(options?.capabilitySources),
      );

      return ok({
        ...interpreted.value,
        extensionPacks: sortDeep(extensionPacks) as never,
        capabilities: sortDeep(mergedCapabilities) as never,
      });
    },
    ...ifDefined('output', options?.output),
  };
}
