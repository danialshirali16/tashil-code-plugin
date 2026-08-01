import { renderImportLines } from './layout/imports';
import type { ComponentUsage } from './layout/types';

export function generateCodeConnectFile(
  componentName: string,
  figmaComponentUrl: string,
  usage: ComponentUsage,
): { code: string; fileName: string } {
  const jsx = usage.jsx.split('\n').map((line) => `    ${line}`).join('\n');
  const imports = renderImportLines(usage.imports);
  return {
    fileName: `${componentName}.figma.tsx`,
    code: [
      'import figma from "@figma/code-connect";',
      imports,
      '',
      `figma.connect(${componentName}, ${JSON.stringify(figmaComponentUrl)}, {`,
      '  example: () => (',
      jsx,
      '  ),',
      '});',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'),
  };
}
