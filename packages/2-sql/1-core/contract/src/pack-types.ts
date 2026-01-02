import type { DescriptorDeclarativeFields } from '@prisma-next/contract/framework-components';
import type { OperationManifest, TypesImportSpec } from '@prisma-next/contract/types';

/**
 * Storage type metadata for pack refs.
 */
export interface StorageTypeMetadata {
  readonly typeId: string;
  readonly familyId: string;
  readonly targetId: string;
  readonly nativeType?: string;
}

/**
 * Base shape for any pack reference.
 * Pack refs are pure JSON-friendly objects safe to import in authoring flows.
 */
export interface PackRefBase<Kind extends string, TFamilyId extends string>
  extends DescriptorDeclarativeFields {
  readonly kind: Kind;
  readonly id: string;
  readonly familyId: TFamilyId;
  readonly targetId?: string;
}

export type TargetPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'target', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type AdapterPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'adapter', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type ExtensionPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'extension', TFamilyId> & {
  readonly targetId: TTargetId;
};

export type DriverPackRef<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> = PackRefBase<'driver', TFamilyId> & {
  readonly targetId: TTargetId;
};
