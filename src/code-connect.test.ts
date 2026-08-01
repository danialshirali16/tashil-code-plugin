import { describe, expect, it } from 'vitest';
import { generateCodeConnectFile } from './code-connect';

describe('Code Connect output', () => {
  it('creates an explicit downloadable figma.connect file from shared usage', () => {
    expect(generateCodeConnectFile('Button', 'https://www.figma.com/design/key?node-id=1-2', {
      diagnostics: [],
      imports: [{ importedName: 'Button', localName: 'Button', modulePath: '@app/button' }],
      jsx: '<Button disabled />',
    })).toEqual({
      fileName: 'Button.figma.tsx',
      code: 'import figma from "@figma/code-connect";\nimport { Button } from "@app/button";\n\nfigma.connect(Button, "https://www.figma.com/design/key?node-id=1-2", {\n  example: () => (\n    <Button disabled />\n  ),\n});',
    });
  });
});
