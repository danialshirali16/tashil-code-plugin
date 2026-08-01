export type OutputPreferences = {
  copyMode: 'full' | 'without-imports' | 'imports-only';
  indentation: '2' | '4' | 'tab';
  previewDirection: 'ltr' | 'rtl';
  quoteStyle: 'double' | 'single';
  semicolons: boolean;
  styledComponentPattern: string;
  trailingComma: boolean;
};

export const DEFAULT_OUTPUT_PREFERENCES: OutputPreferences = {
  copyMode: 'full',
  indentation: '2',
  previewDirection: 'ltr',
  quoteStyle: 'double',
  semicolons: true,
  styledComponentPattern: '{Name}Root',
  trailingComma: true,
};

export function readOutputPreferences(value: unknown): OutputPreferences {
  if (!isRecord(value)) return { ...DEFAULT_OUTPUT_PREFERENCES };
  return {
    copyMode: value.copyMode === 'without-imports' || value.copyMode === 'imports-only' ? value.copyMode : 'full',
    indentation: value.indentation === '4' || value.indentation === 'tab' ? value.indentation : '2',
    previewDirection: value.previewDirection === 'rtl' ? 'rtl' : 'ltr',
    quoteStyle: value.quoteStyle === 'single' ? 'single' : 'double',
    semicolons: value.semicolons !== false,
    styledComponentPattern: validPattern(value.styledComponentPattern) ? value.styledComponentPattern : '{Name}Root',
    trailingComma: value.trailingComma !== false,
  };
}

export function formatGeneratedCode(code: string, preferences: OutputPreferences): string {
  if (samePreferences(preferences, DEFAULT_OUTPUT_PREFERENCES)) return code;
  let result = applyStyledPattern(code, preferences.styledComponentPattern);
  if (preferences.quoteStyle === 'single') result = convertDoubleQuotedStrings(result);
  if (!preferences.trailingComma) {
    const lines = result.split('\n');
    result = lines.map((line, index) => {
      if (!line.trimEnd().endsWith(',')) return line;
      const next = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0)?.trim();
      return next?.startsWith('}') || next?.startsWith(']') ? line.replace(/,\s*$/, '') : line;
    }).join('\n');
  }
  if (!preferences.semicolons) result = result.split('\n').map((line) => line.replace(/;\s*$/, '')).join('\n');
  if (preferences.indentation !== '2') {
    result = result.split('\n').map((line) => {
      const match = /^( +)/.exec(line);
      if (!match) return line;
      const levels = Math.floor(match[1].length / 2);
      const remainder = match[1].length % 2;
      const prefix = preferences.indentation === 'tab' ? '\t'.repeat(levels) : ' '.repeat(levels * 4);
      return `${prefix}${' '.repeat(remainder)}${line.slice(match[1].length)}`;
    }).join('\n');
  }
  return result;
}

export function selectCopyContent(code: string, mode: OutputPreferences['copyMode']): string {
  if (mode === 'full') return code;
  const lines = code.split('\n');
  const imports = lines.filter((line) => /^import\s/.test(line));
  if (mode === 'imports-only') return imports.join('\n');
  return lines.filter((line) => !/^import\s/.test(line)).join('\n').replace(/^\n+/, '');
}

function applyStyledPattern(code: string, pattern: string): string {
  if (pattern === '{Name}Root') return code;
  const renames = new Map<string, string>();
  for (const match of code.matchAll(/\bconst\s+([A-Z_$][A-Za-z0-9_$]*)Root\s*=\s*styled\./g)) {
    renames.set(`${match[1]}Root`, pattern.replace('{Name}', match[1]));
  }
  let result = code;
  for (const [before, after] of renames) result = result.replace(new RegExp(`\\b${before}\\b`, 'g'), after);
  return result;
}

function convertDoubleQuotedStrings(code: string): string {
  return code.replace(/"(?:\\.|[^"\\])*"/g, (literal) => {
    const content = literal.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
    return `'${content}'`;
  });
}

function validPattern(value: unknown): value is string {
  return typeof value === 'string' && value.includes('{Name}')
    && /^[A-Za-z_$][A-Za-z0-9_${}]*$/.test(value.replace('{Name}', 'Name'));
}
function samePreferences(first: OutputPreferences, second: OutputPreferences): boolean {
  return Object.keys(second).every((key) => first[key as keyof OutputPreferences] === second[key as keyof OutputPreferences]);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
