import { formatTokenName, formatTokenValue, serializeCollection } from './serialize';
import type { ExportOptions, OutputFormat, Token, TokenCollection } from './types';

export type SerializedTokenCollection = { content: string; extension: string };

export function serializeTokenCollection(
  collection: TokenCollection,
  options: ExportOptions,
): SerializedTokenCollection {
  const format: OutputFormat = options.outputFormat ?? 'css';
  switch (format) {
    case 'css': return { content: serializeCollection(collection, options), extension: 'css' };
    case 'json-flat': return { content: serializeFlatJson(collection, options), extension: 'json' };
    case 'json-dtcg': return { content: serializeDtcg(collection, options), extension: 'json' };
    case 'scss': return { content: serializeScss(collection, options), extension: 'scss' };
    case 'tailwind-theme': return { content: serializeTailwindTheme(collection, options), extension: 'ts' };
  }
}

export function serializeFlatJson(collection: TokenCollection, options: ExportOptions): string {
  const jsonOptions: ExportOptions = { ...options, colorFormat: 'hex' };
  const values = Object.fromEntries(collection.tokens.map((token) => [
    formatTokenName(token.name, options.nameStyle),
    formatTokenValue(token, jsonOptions),
  ]));
  return `${JSON.stringify(values, null, 2)}\n`;
}

export function serializeDtcg(collection: TokenCollection, options: ExportOptions): string {
  const jsonOptions: ExportOptions = { ...options, colorFormat: 'hex' };
  const root: Record<string, unknown> = {};
  for (const token of collection.tokens) {
    const segments = token.name.split('/').map((segment) => segment.trim()).filter(Boolean);
    let target = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment];
      const child = typeof existing === 'object' && existing !== null
        ? existing as Record<string, unknown>
        : {};
      target[segment] = child;
      target = child;
    }
    target[segments[segments.length - 1] ?? 'unnamed'] = {
      $type: dtcgType(token),
      $value: formatTokenValue(token, jsonOptions),
    };
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function serializeScss(collection: TokenCollection, options: ExportOptions): string {
  const entries = collection.tokens.map((token) => ({
    name: formatTokenName(token.name, options.nameStyle).replace(/[./]/g, '-'),
    value: formatTokenValue(token, options).replace(
      /var\(--([^),]+)\)/g,
      (_match, name: string) => `$${name.replace(/[\\./]/g, '-')}`,
    ),
  }));
  return [
    `// ${collection.name} — exported from Figma variables`,
    ...entries.map(({ name, value }) => `$${name}: ${value};`),
    '',
    '$tokens: (',
    ...entries.map(({ name }) => `  "${name}": $${name},`),
    ');',
  ].join('\n');
}

export function serializeTailwindTheme(collection: TokenCollection, options: ExportOptions): string {
  const entries = collection.tokens.map((token) => [
    formatTokenName(token.name, options.nameStyle),
    formatTokenValue(token, options),
  ] as const);
  return [
    `// ${collection.name} — exported from Figma variables`,
    'export default {',
    '  theme: {',
    '    extend: {',
    '      tokens: {',
    ...entries.map(([name, value]) => `        ${JSON.stringify(name)}: ${JSON.stringify(value)},`),
    '      },',
    '    },',
    '  },',
    '};',
  ].join('\n');
}

export function createTokenSnapshot(tokens: readonly Token[]): Record<string, string> {
  return Object.fromEntries(tokens.map((token) => [token.id, stableTokenValue(token)]));
}

function stableTokenValue(token: Token): string {
  const value = JSON.stringify({ name: token.name, resolvedType: token.resolvedType, value: token.value });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function dtcgType(token: Token): string {
  if (token.resolvedType === 'COLOR') return 'color';
  if (token.resolvedType === 'BOOLEAN') return 'boolean';
  if (token.resolvedType === 'STRING') return 'string';
  return 'number';
}
