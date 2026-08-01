import { renderImportLines } from './layout/imports';
import type { ComponentUsage } from './layout/types';

export const STORYBOOK_COMBINATION_LIMIT = 32;

export type StorybookStory = {
  name: string;
  usage: ComponentUsage;
};

export function generateStorybookCsf(
  componentName: string,
  stories: readonly StorybookStory[],
): string {
  const imports = renderImportLines(stories.flatMap((story) => story.usage.imports));
  const usedNames = new Set<string>();
  const storyBlocks = stories.map((story, index) => {
    const exportName = uniqueStoryName(story.name || `Variant ${index + 1}`, usedNames);
    const args = story.usage.storyArgs;
    return [
      `export const ${exportName}: Story = {`,
      ...(args ? [
        '  args: {',
        ...args.map((attribute) => `    ${formatArg(attribute)},`),
        '  },',
      ] : [
        '  render: () => (',
        indent(story.usage.jsx, 4),
        '  ),',
      ]),
      '};',
    ].join('\n');
  });

  return [
    `import type { Meta, StoryObj } from "@storybook/react";`,
    imports,
    '',
    'const meta = {',
    `  component: ${componentName},`,
    `  title: "Components/${componentName}",`,
    '} satisfies Meta<typeof ' + componentName + '>;',
    '',
    'export default meta;',
    'type Story = StoryObj<typeof meta>;',
    '',
    ...storyBlocks.flatMap((block, index) => index === 0 ? [block] : ['', block]),
    '',
  ].join('\n');
}

function formatArg(attribute: string): string {
  const equals = attribute.indexOf('=');
  if (equals < 0) return `${formatKey(attribute)}: true`;
  const key = formatKey(attribute.slice(0, equals));
  const raw = attribute.slice(equals + 1);
  const value = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1) : raw;
  return `${key}: ${value}`;
}

function formatKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function uniqueStoryName(value: string, used: Set<string>): string {
  const base = value
    .replace(/#.*$/g, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('') || 'Default';
  const safeBase = /^[A-Za-z_$]/.test(base) ? base : `Variant${base}`;
  let candidate = safeBase;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${safeBase}${suffix++}`;
  used.add(candidate);
  return candidate;
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}
