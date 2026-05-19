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
 */
export type PrintNamespaceSection = {
  readonly name: string;
  readonly enums: readonly PrintEnumSection[];
  readonly models: readonly PrinterModel[];
};

export type PrintDocument = {
  readonly headerComment: string;
  readonly namedTypes: readonly PrinterNamedType[];
  readonly namespaces: readonly PrintNamespaceSection[];
};
