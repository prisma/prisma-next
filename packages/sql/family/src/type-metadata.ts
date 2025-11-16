import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlTypeMetadata, SqlTypeMetadataRegistry } from './types';
import { createSqlTypeMetadataRegistryFromEntries } from './types';

/**
 * Source of SQL type metadata for building a registry.
 * Adapters contribute via their runtime codecs, while control-plane extensions
 * can contribute metadata directly.
 */
export interface SqlTypeMetadataSource {
  /**
   * Adapters contribute via their runtime codec registry.
   * Each codec is projected to SqlTypeMetadata using:
   * - typeId from codec.id
   * - targetTypes from codec.targetTypes
   * - nativeType from codec.meta?.db?.sql?.postgres?.nativeType
   */
  readonly codecRegistry?: CodecRegistry;

  /**
   * Control-plane extensions can contribute metadata directly.
   * This allows extensions to declare additional types (e.g., vector types)
   * without requiring runtime codec instantiation.
   */
  readonly typeMetadata?: ReadonlyArray<SqlTypeMetadata>;
}

/**
 * Creates a SqlTypeMetadataRegistry from adapter codecs and extension metadata.
 *
 * The function:
 * - Projects each codec from codecRegistry to SqlTypeMetadata
 * - Includes typeMetadata entries as-is
 * - Deduplicates by typeId with resolution order:
 *   1. Adapter entries (from codecRegistry)
 *   2. Extension entries (from typeMetadata)
 *   3. Later entries in the sources array win over earlier ones
 *
 * @param sources - Array of metadata sources (adapter codecs, extension metadata)
 * @returns SqlTypeMetadataRegistry with deduplicated entries
 */
export function createSqlTypeMetadataRegistry(
  sources: ReadonlyArray<SqlTypeMetadataSource>,
): SqlTypeMetadataRegistry {
  const metadataMap = new Map<string, SqlTypeMetadata>();

  // Process sources in order (later entries win over earlier ones)
  for (const source of sources) {
    // Process codec registry (adapter codecs)
    if (source.codecRegistry) {
      for (const codec of source.codecRegistry.values()) {
        const nativeType = codec.meta?.db?.sql?.postgres?.nativeType;
        const metadata: SqlTypeMetadata = {
          typeId: codec.id,
          targetTypes: codec.targetTypes,
          ...(nativeType !== undefined ? { nativeType } : {}),
        };
        // Adapter entries win over extensions (only set if not already present)
        if (!metadataMap.has(metadata.typeId)) {
          metadataMap.set(metadata.typeId, metadata);
        }
      }
    }

    // Process explicit type metadata (extension metadata)
    if (source.typeMetadata) {
      for (const metadata of source.typeMetadata) {
        // Extensions only set if adapter hasn't already set this typeId
        if (!metadataMap.has(metadata.typeId)) {
          metadataMap.set(metadata.typeId, metadata);
        }
      }
    }
  }

  return createSqlTypeMetadataRegistryFromEntries(Array.from(metadataMap.values()));
}
