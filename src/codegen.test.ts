import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import {
  createMappedProps,
  createOpeningTag,
  createUsageSnippet,
  escapeJsxText,
  formatPropAssignment,
  formatPropValue,
  isConnectionMetadata,
  validateConnectionMetadata,
  type CodeProp,
  type SelectionLike,
} from './codegen';
import type { ConnectionMetadata } from './types';

function expectValidTypeScript(source: string): void {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'generated-snippet.tsx',
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

  expect(errors).toEqual([]);
}

function createValidUsageSnippet(metadata: ConnectionMetadata, selection: SelectionLike): string {
  const snippet = createUsageSnippet(metadata, selection);
  expectValidTypeScript(snippet);
  return snippet;
}

describe('escapeJsxText', () => {
  it('escapes ampersands, angle brackets, and braces', () => {
    expect(escapeJsxText('A & B < C > D {E} F'))
      .toBe('A &amp; B &lt; C &gt; D &#123;E&#125; F');
  });

  it('escapes & before other characters so output is not double-escaped', () => {
    expect(escapeJsxText('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeJsxText('Button')).toBe('Button');
  });
});

describe('formatPropValue', () => {
  it('serializes strings as JSX expressions', () => {
    expect(formatPropValue('primary')).toBe('{"primary"}');
    expect(formatPropValue('say "hi" \\done\nnext')).toBe('{"say \\"hi\\" \\\\done\\nnext"}');
  });

  it('wraps numbers and booleans in braces', () => {
    expect(formatPropValue(42)).toBe('{42}');
    expect(formatPropValue(true)).toBe('{true}');
  });
});

describe('formatPropAssignment', () => {
  it('returns null for false (omits the prop)', () => {
    expect(formatPropAssignment('disabled', { value: false })).toBeNull();
  });

  it('returns a bare prop name for true', () => {
    expect(formatPropAssignment('loading', { value: true })).toBe('loading');
  });

  it('serializes string attributes as JSX expressions', () => {
    expect(formatPropAssignment('intent', { value: 'primary' })).toBe('intent={"primary"}');
  });

  it('returns a brace expression for raw strings', () => {
    const prop: CodeProp = { value: '<Icon />', raw: true };
    expect(formatPropAssignment('leadingIcon', prop)).toBe('leadingIcon={<Icon />}');
  });

  it('returns a brace expression for numbers', () => {
    expect(formatPropAssignment('count', { value: 3 })).toBe('count={3}');
  });

  it('rejects prop names that could break generated JSX', () => {
    expect(() => formatPropAssignment('intent onClick', { value: 'primary' }))
      .toThrow(/prop identifier/i);
  });
});

describe('createOpeningTag', () => {
  it('renders a self-closing-style open tag with no props', () => {
    expect(createOpeningTag('Button', [])).toBe('<Button>');
  });

  it('renders props inline when there are three or fewer', () => {
    expect(createOpeningTag('Button', ['a="1"', 'b="2"'])).toBe('<Button a="1" b="2">');
  });

  it('renders props on separate lines when there are more than three', () => {
    expect(createOpeningTag('Button', ['a="1"', 'b="2"', 'c="3"', 'd="4"']))
      .toBe('<Button\n  a="1"\n  b="2"\n  c="3"\n  d="4"\n>');
  });
});

describe('createMappedProps', () => {
  const metadata = (overrides: Partial<ConnectionMetadata> = {}): ConnectionMetadata => ({
    componentName: 'Button',
    importPath: 'tashil-ui',
    ...overrides,
  });

  it('emits default props when no component properties are set', () => {
    const m = metadata({
      defaultProps: { intent: 'primary', variant: 'solid', size: 'md' },
    });
    expect(createMappedProps(m, {})).toEqual(['intent={"primary"}', 'variant={"solid"}', 'size={"md"}']);
  });

  it('overrides defaults with mapped component properties', () => {
    const m = metadata({
      defaultProps: { intent: 'primary' },
      propMappings: {
        intent: { primary: { prop: 'intent', value: 'neutral' } },
        style: { solid: { prop: 'variant', value: 'outline' } },
      },
    });
    expect(createMappedProps(m, { intent: 'primary', style: 'solid' }))
      .toEqual(['intent={"neutral"}', 'variant={"outline"}']);
  });

  it('omits props whose mapped value is false', () => {
    const m = metadata({
      propMappings: { state: { disabled: { prop: 'disabled', value: false } } },
    });
    expect(createMappedProps(m, { state: 'disabled' })).toEqual([]);
  });

  it('emits bare boolean props for true values', () => {
    const m = metadata({
      propMappings: { state: { loading: { prop: 'loading', value: true } } },
    });
    expect(createMappedProps(m, { state: 'loading' })).toEqual(['loading']);
  });
});

describe('createUsageSnippet', () => {
  const selection = (overrides: Partial<SelectionLike> = {}): SelectionLike => ({
    componentProperties: {},
    displayText: 'Button',
    ...overrides,
  });

  it('renders an import line plus a usage tag', () => {
    const metadata: ConnectionMetadata = {
      componentName: 'Button',
      importPath: 'tashil-ui',
      defaultProps: { intent: 'primary' },
    };
    expect(createValidUsageSnippet(metadata, selection())).toBe(
      [
        'import { Button } from "tashil-ui";',
        '',
        '<Button intent={"primary"}>',
        '  Button',
        '</Button>',
      ].join('\n'),
    );
  });

  it('uses the componentProperties label when present, falling back to displayText', () => {
    const metadata: ConnectionMetadata = {
      componentName: 'Button',
      importPath: 'tashil-ui',
    };
    expect(createValidUsageSnippet(metadata, selection({ componentProperties: { label: 'Submit' } })))
      .toContain('  Submit');
  });

  it('renders the iconOnly branch with aria-label and <Icon />', () => {
    const metadata: ConnectionMetadata = {
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      propMappings: { isOnlyIcon: { true: { prop: 'iconOnly', value: true } } },
    };
    const snippet = createValidUsageSnippet(metadata, {
      componentProperties: { isOnlyIcon: 'true', label: 'Delete' },
      displayText: 'IconButton',
    });
    expect(snippet).toContain('aria-label={"Delete"}');
    expect(snippet).toContain('  <Icon />');
  });

  it('escapes special characters in the label text', () => {
    const metadata: ConnectionMetadata = {
      componentName: 'Tag',
      importPath: 'tashil-ui',
    };
    const snippet = createValidUsageSnippet(metadata, { componentProperties: { label: 'A & B' }, displayText: 'A & B' });
    expect(snippet).toContain('  A &amp; B');
  });

  it('safely serializes quotes, backslashes, newlines, and import paths', () => {
    const importPath = 'tashil-"ui\\components\nbutton';
    const metadata: ConnectionMetadata = {
      componentName: 'Button',
      importPath,
      defaultProps: { title: 'say "hi" \\done\nnext' },
    };
    const snippet = createValidUsageSnippet(metadata, selection());

    expect(snippet).toContain(`from ${JSON.stringify(importPath)};`);
    expect(snippet).toContain('title={"say \\"hi\\" \\\\done\\nnext"}');
  });
});

describe('isConnectionMetadata', () => {
  it('accepts a minimal valid connection', () => {
    expect(isConnectionMetadata({ componentName: 'Button', importPath: 'tashil-ui' })).toBe(true);
  });

  it('rejects when componentName is missing or empty', () => {
    expect(isConnectionMetadata({ importPath: 'tashil-ui' })).toBe(false);
    expect(isConnectionMetadata({ componentName: '', importPath: 'tashil-ui' })).toBe(false);
  });

  it('rejects invalid component and prop identifiers', () => {
    expect(isConnectionMetadata({ componentName: 'Button;alert(1)', importPath: 'tashil-ui' }))
      .toBe(false);
    expect(isConnectionMetadata({ componentName: 'button', importPath: 'tashil-ui' }))
      .toBe(false);
    expect(isConnectionMetadata({
      componentName: 'Button',
      importPath: 'tashil-ui',
      defaultProps: { 'intent onClick': 'primary' },
    })).toBe(false);
    expect(isConnectionMetadata({
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: { intent: { primary: { prop: 'intent={evil}', value: 'primary' } } },
    })).toBe(false);
  });

  it('rejects when importPath is missing', () => {
    expect(isConnectionMetadata({ componentName: 'Button' })).toBe(false);
  });

  it('rejects malformed propMappings', () => {
    expect(isConnectionMetadata({
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: { intent: { primary: { prop: 'intent' } } }, // missing value
    })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isConnectionMetadata(null)).toBe(false);
    expect(isConnectionMetadata('nope')).toBe(false);
    expect(isConnectionMetadata([])).toBe(false);
  });
});

describe('validateConnectionMetadata', () => {
  it('returns ok for valid metadata', () => {
    expect(validateConnectionMetadata({ componentName: 'Button', importPath: 'tashil-ui' }))
      .toEqual({ ok: true });
  });

  it('returns a message for invalid metadata', () => {
    const result = validateConnectionMetadata({ componentName: '', importPath: '' });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/component name/i);
  });
});
