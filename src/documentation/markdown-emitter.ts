/**
 * Pure Markdown documentation emitter.
 *
 * Formats TokenDocDocument and ComponentDocDocument models into clean, structured
 * Markdown / MDX documentation with tables, swatches, and code blocks.
 */

import type {
  ComponentDocDocument,
  TokenDocDocument,
  TokenDocSection,
} from './types';

export function emitTokenDocMarkdown(doc: TokenDocDocument): string {
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `> ${doc.description}`,
    '',
    `**Total Tokens**: ${doc.totalTokens} | **Modes**: ${doc.modes.map((m) => `\`${m.name}\``).join(', ')}`,
    '',
  ];

  for (const section of doc.sections) {
    lines.push(...emitSectionMarkdown(section, doc.modes));
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function emitSectionMarkdown(
  section: TokenDocSection,
  modes: TokenDocDocument['modes'],
): string[] {
  const lines: string[] = [
    `## ${section.headline}`,
    '',
    section.description,
    '',
  ];

  // Table header
  const headers = ['Token', ...modes.map((m) => m.name)];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  for (const token of section.tokens) {
    const row = [
      `\`${token.name}\``,
      ...modes.map((m) => {
        const val = token.valuesByMode[m.modeId];
        if (!val) return '-';
        if (val.resolvedType === 'COLOR') {
          const hex = val.hexColor ?? String(val.rawValue);
          const alias = val.aliasTargetName ? ` (\`${val.aliasTargetName}\`)` : '';
          return `\`${hex}\`${alias}`;
        }
        if (val.aliasTargetName) {
          return `\`${val.rawValue}\` (\`${val.aliasTargetName}\`)`;
        }
        return `\`${val.rawValue}\``;
      }),
    ];
    lines.push(`| ${row.join(' | ')} |`);
  }

  return lines;
}

export function emitComponentDocMarkdown(doc: ComponentDocDocument): string {
  const lines: string[] = [
    `# <${doc.componentName} />`,
    '',
    `> ${doc.description}`,
    '',
    `* **Import**: \`import { ${doc.componentName} } from "${doc.importPath}"\``,
    `* **Figma Component**: \`${doc.figmaComponentName}\``,
    ...(doc.lifecycle ? [`* **Lifecycle**: \`${doc.lifecycle}\``] : []),
    ...(doc.storybookUrl ? [`* **Storybook**: [View in Storybook](${doc.storybookUrl})`] : []),
    '',
    '## Usage',
    '',
    '```tsx',
    doc.sampleUsageCode,
    '```',
    '',
    '## Props Specification',
    '',
    '| Prop | Type | Required | Default | Figma Binding | Description |',
    '| --- | --- | :---: | --- | --- | --- |',
  ];

  for (const prop of doc.props) {
    const req = prop.required ? 'Yes' : 'No';
    const def = prop.defaultValue !== undefined ? `\`${JSON.stringify(prop.defaultValue)}\`` : '-';
    const figma = prop.mappedFigmaProperty ? `\`${prop.mappedFigmaProperty}\`` : '-';
    const desc = prop.description ? prop.description.replace(/\|/g, '\\|') : '-';
    lines.push(`| \`${prop.name}\` | \`${prop.typeName}\` | ${req} | ${def} | ${figma} | ${desc} |`);
  }

  if (doc.runtimeRequirements.length > 0) {
    lines.push('');
    lines.push('## Set in Application (Runtime Requirements)');
    lines.push('');
    lines.push('These props must be supplied by application code:');
    for (const req of doc.runtimeRequirements) {
      lines.push(`* \`${req}\``);
    }
  }

  if (doc.variants.length > 0) {
    lines.push('');
    lines.push('## Available Variants');
    lines.push('');
    for (const v of doc.variants) {
      lines.push(`* **${v.title}**`);
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
