import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OUTPUT_PREFERENCES,
  formatGeneratedCode,
  readOutputPreferences,
  selectCopyContent,
} from './output-preferences';

const source = [
  'import { Button } from "@acme/ui";',
  '',
  'const ButtonRoot = styled.div`',
  '  color: red;',
  '`;',
  '',
  'export const Example = {',
  '  label: "Save",',
  '};',
].join('\n');

describe('output preferences', () => {
  it('keeps default output byte-identical', () => {
    expect(formatGeneratedCode(source, DEFAULT_OUTPUT_PREFERENCES)).toBe(source);
  });

  it('applies single quotes, four spaces, no semicolons/commas, and a naming pattern', () => {
    const result = formatGeneratedCode(source, {
      ...DEFAULT_OUTPUT_PREFERENCES,
      indentation: '4',
      quoteStyle: 'single',
      semicolons: false,
      styledComponentPattern: '{Name}Container',
      trailingComma: false,
    });
    expect(result).toContain("import { Button } from '@acme/ui'");
    expect(result).toContain('const ButtonContainer = styled.div`');
    expect(result).toContain("    label: 'Save'");
    expect(result).not.toContain("'Save',");
  });

  it('supports tabs and both partial copy modes', () => {
    expect(formatGeneratedCode(source, { ...DEFAULT_OUTPUT_PREFERENCES, indentation: 'tab' }))
      .toContain("\tlabel: \"Save\",");
    expect(selectCopyContent(source, 'imports-only')).toBe('import { Button } from "@acme/ui";');
    expect(selectCopyContent(source, 'without-imports')).not.toContain('import ');
  });

  it('normalizes invalid persisted settings without changing defaults', () => {
    expect(readOutputPreferences({ quoteStyle: 'bad', styledComponentPattern: 'invalid' }))
      .toEqual(DEFAULT_OUTPUT_PREFERENCES);
  });
});
