import { dirname } from 'pathe';
import { type AuthoringId, schemaSample, type TargetId } from './code-templates';
import { renderTemplate } from './render';

export const variables = [
  'schemaPath',
  'schemaDir',
  'dbImportPath',
  'pkgRun',
  'schemaSample',
] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

export function quickReferenceMd(
  target: TargetId,
  authoring: AuthoringId,
  schemaPath: string,
  pkgRun: string,
): string {
  const schemaDir = dirname(schemaPath);
  const vars: TemplateVars = {
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun,
    schemaSample: schemaSample(target, authoring),
  };
  const templateFile = `quick-reference-${target}.md`;
  return renderTemplate(templateFile, variables, vars);
}
