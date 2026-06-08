import type { PslExtensionBlock } from '@prisma-next/framework-components/psl-ast';
import type { PrinterEnumValue, PrinterModel, PrinterNamedType } from './types';

export type PrintEnumSection = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly values: readonly PrinterEnumValue[];
};

/**
 * A namespace's print-time contents. The framework parser collects top-level
 * declarations (no `namespace { … }` wrapper in source) into the
 * `__unspecified__` synthesised bucket; the printer recognises that name
 * specially and emits its contents at the document top level with no
 * `namespace { … }` wrapper. Named namespaces emit a `namespace <name> { … }`
 * block around their contents.
 *
 * `extensionBlocks` carries extension-contributed top-level blocks verbatim from the
 * input AST. Phase 1 (`astDocumentToPrintDocument`) does no transformation
 * here — phase 2 (`serializePrintDocument`) consults the registered
 * `pslBlockDescriptors` contribution by `kind` discriminator and renders each entry
 * generically from the descriptor's `parameters` map. The slot is always
 * present; an empty array means no extension-contributed blocks landed in
 * this namespace.
 */
export type PrintNamespaceSection = {
  readonly name: string;
  readonly enums: readonly PrintEnumSection[];
  readonly models: readonly PrinterModel[];
  readonly extensionBlocks: readonly PslExtensionBlock[];
};

export type PrintDocument = {
  readonly headerComment: string;
  readonly namedTypes: readonly PrinterNamedType[];
  readonly namespaces: readonly PrintNamespaceSection[];
};
