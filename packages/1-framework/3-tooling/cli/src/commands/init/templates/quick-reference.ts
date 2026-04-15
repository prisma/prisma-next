import { type TargetId, targetLabel, targetPackageName } from './code-templates';
import { renderTemplate } from './render';

export const variables = ['pkg', 'targetLabel', 'schemaPath', 'schemaDir', 'dbImportPath'] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

export function quickReferenceMd(target: TargetId, schemaPath: string): string {
  const schemaDir = schemaPath.replace(/\/[^/]+$/, '');
  const vars: TemplateVars = {
    pkg: targetPackageName(target),
    targetLabel: targetLabel(target),
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
  };
  return renderTemplate('quick-reference.md', variables, vars);
}
