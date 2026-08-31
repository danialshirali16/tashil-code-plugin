import { formatColor, formatNumber, formatTokenName, formatTokenValue, serializeCollection } from './serialize';
import type { ExportOptions, OutputFormat, Token, TokenCollection, TokenValue } from './types';

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
    case 'markdown': return { content: serializeMarkdownTokenList(collection, options), extension: 'md' };
    case 'scss': return { content: serializeScss(collection, options), extension: 'scss' };
    case 'tailwind-theme': return { content: serializeTailwindTheme(collection, options), extension: 'ts' };
    case 'typescript-nested': return { content: serializeTypeScriptNested(collection, options), extension: 'ts' };
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

export function serializeMarkdownTokenList(
  collection: TokenCollection,
  options: ExportOptions,
): string {
  const entries = collection.tokens.map((token) => {
    const name = formatTokenName(token.name, options.nameStyle);
    const value = formatRawTokenValue(token, options);
    return `--${name}: ${value};`;
  });
  return [
    `# ${collection.name}`,
    '',
    '```text',
    ...entries,
    '```',
  ].join('\n');
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

function formatRawTokenValue(token: Token, options: ExportOptions): string {
  return formatTokenValue(token, options).replace(
    /var\(--([^)]*)\)/g,
    (_match, name: string) => `var(--${name.replace(/\\([./])/g, '$1')})`,
  );
}

function dtcgType(token: Token): string {
  if (token.resolvedType === 'COLOR') return 'color';
  if (token.resolvedType === 'BOOLEAN') return 'boolean';
  if (token.resolvedType === 'STRING') return 'string';
  return 'number';
}

type NestedTokenNode = {
  children: Map<string, NestedTokenNode>;
  value?: string;
};

export function serializeTypeScriptNested(
  collection: TokenCollection,
  options: ExportOptions,
): string {
  const typeName = toIdentifierPascalCase(collection.name);
  const varName = toIdentifierCamelCase(collection.name);
  const root: NestedTokenNode = { children: new Map() };

  for (const token of collection.tokens) {
    const segments = token.name
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      continue;
    }

    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = formatSegmentKey(segments[index]!);
      let child = current.children.get(key);
      if (child === undefined) {
        child = { children: new Map() };
        current.children.set(key, child);
      }
      current = child;
    }

    const lastKey = formatSegmentKey(segments[segments.length - 1]!);
    let leaf = current.children.get(lastKey);
    if (leaf === undefined) {
      leaf = { children: new Map() };
      current.children.set(lastKey, leaf);
    }
    leaf.value = formatTokenValueAsJs(token, options);
  }

  const lines: string[] = [
    `import type { ${typeName} } from './types';`,
    '',
    `export const ${varName}: ${typeName} = {`,
  ];

  renderTree(root, 1, lines);
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

function renderTree(node: NestedTokenNode, indentLevel: number, lines: string[]): void {
  const indent = '  '.repeat(indentLevel);
  for (const [key, child] of node.children.entries()) {
    const keyStr = /^\d+$/.test(key) || /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
      ? key
      : JSON.stringify(key);
    if (child.children.size > 0) {
      lines.push(`${indent}${keyStr}: {`);
      renderTree(child, indentLevel + 1, lines);
      lines.push(`${indent}},`);
    } else if (child.value !== undefined) {
      lines.push(`${indent}${keyStr}: ${child.value},`);
    }
  }
}

function formatSegmentKey(raw: string): string {
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  return toCamelCase(raw);
}

export function toIdentifierCamelCase(str: string): string {
  let parts = str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter((p) => p.length > 0);
  while (parts.length > 1 && /^\d+$/.test(parts[0]!)) {
    parts = parts.slice(1);
  }
  if (parts.length === 0) {
    return 'tokens';
  }
  if (/^\d+$/.test(parts[0]!)) {
    return `tokens${parts.join('')}`;
  }
  return parts[0]!.toLowerCase() + parts.slice(1).map(capitalizeWord).join('');
}

export function toIdentifierPascalCase(str: string): string {
  let parts = str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter((p) => p.length > 0);
  while (parts.length > 1 && /^\d+$/.test(parts[0]!)) {
    parts = parts.slice(1);
  }
  if (parts.length === 0) {
    return 'Tokens';
  }
  if (/^\d+$/.test(parts[0]!)) {
    return `Tokens${parts.join('')}`;
  }
  return parts.map(capitalizeWord).join('');
}

export function toCamelCase(str: string): string {
  const parts = str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return str;
  }
  return parts[0]!.toLowerCase() + parts.slice(1).map(capitalizeWord).join('');
}

export function toPascalCase(str: string): string {
  const parts = str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return 'Tokens';
  }
  return parts.map(capitalizeWord).join('');
}

function capitalizeWord(word: string): string {
  if (word.length === 0) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function formatAliasJsExpression(targetName: string): string {
  const segments = targetName
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    return 'undefined';
  }
  const first = toCamelCase(segments[0]!);
  let result = first;
  for (let index = 1; index < segments.length; index += 1) {
    const seg = segments[index]!;
    if (/^\d+$/.test(seg)) {
      result += `[${seg}]`;
    } else {
      const camel = toCamelCase(seg);
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(camel)) {
        result += `.${camel}`;
      } else {
        result += `[${JSON.stringify(seg)}]`;
      }
    }
  }
  return result;
}

function formatTokenValueAsJs(token: Token, options: ExportOptions): string {
  return formatTokenValueOfAsJs(token.value, token, options);
}

function formatTokenValueOfAsJs(
  value: TokenValue,
  token: Token,
  options: ExportOptions,
): string {
  switch (value.kind) {
    case 'color': {
      const colorFormat = options.colorFormat === 'variable' ? 'hex' : options.colorFormat;
      const color = formatColor(value.value, colorFormat);
      return `'${color}'`;
    }
    case 'alias': {
      if (options.colorFormat === 'variable') {
        return formatAliasJsExpression(value.value.targetName);
      }
      if (value.value.resolvedValue !== undefined) {
        return formatTokenValueOfAsJs(value.value.resolvedValue, token, options);
      }
      return formatAliasJsExpression(value.value.targetName);
    }
    case 'number': {
      const num = formatNumber(value.value, token, options);
      return num.endsWith('rem') || num.endsWith('px') ? `'${num}'` : num;
    }
    case 'string':
      return JSON.stringify(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
  }
}
