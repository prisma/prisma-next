import { dirname } from 'pathe';
import type { TargetId } from './code-templates';
import { renderTemplate } from './render';

export const variables = ['schemaPath', 'schemaDir', 'dbImportPath'] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

export function quickReferenceMd(target: TargetId, schemaPath: string): string {
  const schemaDir = dirname(schemaPath);
  const vars: TemplateVars = {
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
  };
  const templateFile = `quick-reference-${target}.md`;
  return renderTemplate(templateFile, variables, vars);
}
