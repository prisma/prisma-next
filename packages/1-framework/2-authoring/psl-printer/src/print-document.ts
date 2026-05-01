import type { PrinterEnumValue, PrinterModel, PrinterNamedType } from './types';

export type PrintEnumSection = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly values: readonly PrinterEnumValue[];
};

export type PrintDocument = {
  readonly headerComment: string;
  readonly namedTypes: readonly PrinterNamedType[];
  readonly enums: readonly PrintEnumSection[];
  readonly models: readonly PrinterModel[];
};
