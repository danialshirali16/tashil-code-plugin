import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import {
  createMappedProps,
  createOpeningTag,
  createSelfClosingTag,
  createUsageSnippet,
  formatMappingDiagnostics,
  formatJsxChildren,
  formatPropAssignment,
  formatPropValue,
  isConnectionMetadata,
  migratePersistedConnectionMetadata,
  resolveChildrenText,
  validatePersistedConnectionMetadata,
  validateConnectionMetadata,
  type CodeProp,
  type SelectionLike,
} from './codegen';
import { CURRENT_SCHEMA_VERSION, type ConnectionMetadata } from './types';

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
  const result = createUsageSnippet(metadata, selection);
  expectValidTypeScript(result.code);
  return result.code;
}

describe('formatJsxChildren', () => {
  it('leaves plain text unchanged (bare JSX text)', () => {
    expect(formatJsxChildren('Button')).toBe('Button');
  });

  it('wraps labels with ampersands in a string expression', () => {
    expect(formatJsxChildren('Tom & Jerry')).toBe('{"Tom & Jerry"}');
  });

  it('wraps labels with angle brackets and braces in a string expression', () => {
    expect(formatJsxChildren('A & B < C > D {E} F')).toBe('{"A & B < C > D {E} F"}');
  });

  it('safely serializes quotes and backslashes inside a triggered wrap', () => {
    // `&` triggers the wrap; quotes and backslashes must be escaped in the
    // resulting string expression.
    expect(formatJsxChildren('A & "hi" \\done')).toBe('{"A & \\"hi\\" \\\\done"}');
  });

  it('leaves quote-only labels as bare text (quotes are valid JSX text)', () => {
    expect(formatJsxChildren('say "hi"')).toBe('say "hi"');
  });

  it('keeps safe single-line text with internal spaces bare', () => {
    expect(formatJsxChildren('Primary  action')).toBe('Primary  action');
  });

  it.each([
    ['leading whitespace', ' Button', '{" Button"}'],
    ['trailing whitespace', 'Button ', '{"Button "}'],
    ['a line feed', 'First\nSecond', '{"First\\nSecond"}'],
    ['a carriage return', 'First\rSecond', '{"First\\rSecond"}'],
    ['an internal tab', 'First\tSecond', '{"First\\tSecond"}'],
    ['an internal form feed', 'First\fSecond', '{"First\\fSecond"}'],
  ])('wraps %s in an exact JSON-string expression', (_case, input, expected) => {
    expect(formatJsxChildren(input)).toBe(expected);
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

describe('createSelfClosingTag', () => {
  it('renders empty and inline self-closing tags', () => {
    expect(createSelfClosingTag('Divider', [])).toBe('<Divider />');
    expect(createSelfClosingTag('Divider', ['tone={"subtle"}']))
      .toBe('<Divider tone={"subtle"} />');
  });

  it('renders multiline props with a valid self-closing terminator', () => {
    expect(createSelfClosingTag('Divider', ['a={1}', 'b={2}', 'c={3}', 'd={4}']))
      .toBe('<Divider\n  a={1}\n  b={2}\n  c={3}\n  d={4}\n/>');
  });
});

describe('createMappedProps', () => {
  it('maps component properties to prop assignments', () => {
    const propMappings: ConnectionMetadata['propMappings'] = {
      intent: { primary: { prop: 'intent', value: 'neutral' } },
      style: { solid: { prop: 'variant', value: 'outline' } },
    };
    expect(createMappedProps(propMappings ?? {}, { intent: 'primary', style: 'solid' }).props)
      .toEqual(['intent={"neutral"}', 'variant={"outline"}']);
  });

  it('omits props whose mapped value is false', () => {
    const propMappings: ConnectionMetadata['propMappings'] = {
      state: { disabled: { prop: 'disabled', value: false } },
    };
    expect(createMappedProps(propMappings ?? {}, { state: 'disabled' }).props).toEqual([]);
  });

  it('emits bare boolean props for true values', () => {
    const propMappings: ConnectionMetadata['propMappings'] = {
      state: { loading: { prop: 'loading', value: true } },
    };
    expect(createMappedProps(propMappings ?? {}, { state: 'loading' }).props).toEqual(['loading']);
  });

  it('reports an active value missing from an existing mapping group', () => {
    const result = createMappedProps({
      Size: { Small: { prop: 'size', value: 'sm' } },
    }, { Size: 'Large' });

    expect(result).toEqual({
      diagnostics: [{
        figmaProperty: 'Size',
        figmaValue: 'Large',
        kind: 'unmapped-value',
      }],
      props: [],
    });
  });

  it('resolves a newly selected icon swap to an Icon element', () => {
    const result = createMappedProps({
      leadingIcon: {
        '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
      },
      hasLeadingIcon: {
        true: { prop: 'hasLeadingIcon', value: true },
      },
    }, {
      hasLeadingIcon: true,
      leadingIcon: 'new-icon-id',
    }, {
      instanceSwaps: {
        leadingIcon: {
          componentId: 'new-icon-id',
          componentName: 'Shield',
        },
      },
    });

    expect(result).toEqual({
      diagnostics: [],
      namedImports: ['Icon'],
      props: ['renderRightIcon={<Icon name="shield" />}'],
    });
  });

  it('renders the current mapped icon ID from the live instance swap', () => {
    const result = createMappedProps({
      trailingIcon: {
        'contract-check-id': {
          prop: 'renderLeftIcon',
          value: 'ContractCheck',
        },
      },
    }, {
      trailingIcon: 'contract-check-id',
    }, {
      instanceSwaps: {
        trailingIcon: {
          componentId: 'contract-check-id',
          componentName: 'ContractCheck',
        },
      },
    });

    expect(result).toEqual({
      diagnostics: [],
      namedImports: ['Icon'],
      props: ['renderLeftIcon={<Icon name="contract-check" />}'],
    });
  });

  it('prefers an RTL wildcard target over a stale icon-ID target', () => {
    const result = createMappedProps({
      leadingIcon: {
        '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
        'shield-id': { prop: 'renderLeftIcon', value: 'Shield' },
      },
    }, {
      leadingIcon: 'shield-id',
    }, {
      instanceSwaps: {
        leadingIcon: {
          componentId: 'shield-id',
          componentName: 'Shield',
        },
      },
    });

    expect(result).toEqual({
      diagnostics: [],
      namedImports: ['Icon'],
      props: ['renderRightIcon={<Icon name="shield" />}'],
    });
  });

  it('uses icon visibility properties as guards without emitting React props', () => {
    const result = createMappedProps({
      leadingIcon: {
        'icon-id': { prop: 'renderLeftIcon', value: 'Shield' },
      },
      hasLeadingIcon: {
        false: { prop: 'hasLeadingIcon', value: false },
      },
    }, {
      hasLeadingIcon: false,
      leadingIcon: 'icon-id',
    });

    expect(result).toEqual({ diagnostics: [], props: [] });
  });

  it('does not infer an instance-swap target from an ambiguous mapping group', () => {
    const result = createMappedProps({
      Icon: {
        first: { prop: 'leadingIcon', value: 'First' },
        second: { prop: 'trailingIcon', value: 'Second' },
      },
    }, { Icon: 'new-icon-id' }, {
      instanceSwaps: {
        Icon: {
          componentId: 'new-icon-id',
          componentName: 'Shield',
        },
      },
    });

    expect(result).toEqual({
      diagnostics: [{
        figmaProperty: 'Icon',
        figmaValue: 'new-icon-id',
        kind: 'unmapped-value',
      }],
      props: [],
    });
  });

  it('maps own magic group and option keys', () => {
    const propMappings = JSON.parse([
      '{',
      '  "__proto__": {',
      '    "constructor": { "prop": "tone", "value": "safe" }',
      '  }',
      '}',
    ].join('\n')) as NonNullable<ConnectionMetadata['propMappings']>;
    const componentProperties = JSON.parse(
      '{ "__proto__": "constructor" }',
    ) as Record<string, string | boolean>;

    expect(createMappedProps(propMappings, componentProperties)).toEqual({
      diagnostics: [],
      props: ['tone={"safe"}'],
    });
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'reports an unmapped magic group named %s instead of reading the object prototype',
    (figmaProperty) => {
      const componentProperties = Object.fromEntries([
        [figmaProperty, 'Active'],
      ]) as Record<string, string | boolean>;

      expect(createMappedProps({}, componentProperties)).toEqual({
        diagnostics: [{
          figmaProperty,
          figmaValue: 'Active',
          kind: 'unmapped-property',
        }],
        props: [],
      });
    },
  );

  it.each(['__proto__', 'constructor', 'toString'])(
    'reports an unmapped magic option named %s instead of reading the group prototype',
    (figmaValue) => {
      expect(createMappedProps({ Mode: {} }, { Mode: figmaValue })).toEqual({
        diagnostics: [{
          figmaProperty: 'Mode',
          figmaValue,
          kind: 'unmapped-value',
        }],
        props: [],
      });
    },
  );

  it('ignores only the exact Figma property consumed as children', () => {
    const result = createMappedProps(
      {},
      { Disabled: true, Label: 'Save', label: 'Other' },
      { consumedFigmaProperty: 'Label' },
    );

    expect(result).toEqual({
      diagnostics: [
        {
          figmaProperty: 'Disabled',
          figmaValue: true,
          kind: 'unmapped-property',
        },
        {
          figmaProperty: 'label',
          figmaValue: 'Other',
          kind: 'unmapped-property',
        },
      ],
      props: [],
    });
  });

  it('omits duplicate React targets and reports every conflicting Figma source', () => {
    const result = createMappedProps({
      Appearance: { Solid: { prop: 'tone', value: 'strong' } },
      Intent: { Primary: { prop: 'tone', value: 'brand' } },
    }, { Appearance: 'Solid', Intent: 'Primary' });

    expect(result).toEqual({
      diagnostics: [{
        kind: 'duplicate-target',
        prop: 'tone',
        sources: [
          { figmaProperty: 'Appearance', figmaValue: 'Solid' },
          { figmaProperty: 'Intent', figmaValue: 'Primary' },
        ],
      }],
      props: [],
    });
  });

  it('omits every active candidate for a reserved target and reports all sources', () => {
    const result = createMappedProps({
      Label: { Save: { prop: 'children', value: 'Mapped label' } },
      Title: { Delete: { prop: 'children', value: 'Mapped title' } },
    }, { Label: 'Save', Title: 'Delete' }, {
      reservedReactProps: new Set(['children']),
    });

    expect(result).toEqual({
      diagnostics: [{
        kind: 'reserved-target',
        prop: 'children',
        sources: [
          { figmaProperty: 'Label', figmaValue: 'Save' },
          { figmaProperty: 'Title', figmaValue: 'Delete' },
        ],
      }],
      props: [],
    });
  });
});

describe('formatMappingDiagnostics', () => {
  it('explains why a reserved mapped prop was omitted', () => {
    expect(formatMappingDiagnostics([{
      kind: 'reserved-target',
      prop: 'children',
      sources: [{ figmaProperty: 'Label', figmaValue: 'Save' }],
    }])).toBe([
      'Active mappings target reserved React prop "children": "Label"="Save".',
      'The mapped prop was omitted because the selected children mode owns this prop.',
    ].join(' '));
  });
});

describe('createUsageSnippet', () => {
  const selection = (overrides: Partial<SelectionLike> = {}): SelectionLike => ({
    componentProperties: {},
    displayText: 'Button',
    ...overrides,
  });

  // ---- Golden tests: exact TSX strings for the primary flows (item 1) ----

  it('golden: bare component with no props', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    };
    expect(createValidUsageSnippet(metadata, selection())).toBe(
      [
        'import { Button } from "tashil-ui";',
        '',
        '<Button>',
        '  Button',
        '</Button>',
      ].join('\n'),
    );
  });

  it('golden: button with mapped variant props rendered inline', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: {
        intent: { primary: { prop: 'intent', value: 'primary' } },
        size: { md: { prop: 'size', value: 'md' } },
      },
    };
    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { intent: 'primary', size: 'md', label: 'Submit' },
    }))).toBe(
      [
        'import { Button } from "tashil-ui";',
        '',
        '<Button intent={"primary"} size={"md"}>',
        '  Submit',
        '</Button>',
      ].join('\n'),
    );
  });

  it('golden: active icon swaps render Icon elements with normalized names', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: {
        leadingIcon: {
          '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
        },
        trailingIcon: {
          '*': { prop: 'renderLeftIcon', value: '$instanceSwap' },
        },
      },
    };

    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: {
        hasLeadingIcon: true,
        hasTrailingIcon: true,
        label: 'Submit',
        leadingIcon: 'new-leading-id',
        trailingIcon: 'new-trailing-id',
      },
      instanceSwaps: {
        leadingIcon: {
          componentId: 'new-leading-id',
          componentName: 'Shield',
        },
        trailingIcon: {
          componentId: 'new-trailing-id',
          componentName: 'ContractCheck',
        },
      },
    }))).toBe([
      'import { Button, Icon } from "tashil-ui";',
      '',
      '<Button renderRightIcon={<Icon name="shield" />} renderLeftIcon={<Icon name="contract-check" />}>',
      '  Submit',
      '</Button>',
    ].join('\n'));
  });

  it('golden: Figma icon-only buttons omit label and trailing icon', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'text',
      childrenTextProperty: 'label',
      componentName: 'Button',
      importPath: '@tashilcar/swiss-army-knife',
      propMappings: {
        isOnlyIcon: {
          false: { prop: 'iconOnly', value: false },
          true: { prop: 'iconOnly', value: true },
        },
        leadingIcon: {
          '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
        },
        trailingIcon: {
          '*': { prop: 'renderLeftIcon', value: '$instanceSwap' },
        },
      },
    };

    const result = createUsageSnippet(metadata, selection({
      componentProperties: {
        hasTrailingIcon: true,
        trailingIcon: 'chevron-left-id',
        hasLeadingIcon: true,
        leadingIcon: 'plus-id',
        label: 'متن دکمه',
        isOnlyIcon: 'true',
      },
      instanceSwaps: {
        leadingIcon: {
          componentId: 'plus-id',
          componentName: 'Plus',
        },
        trailingIcon: {
          componentId: 'chevron-left-id',
          componentName: 'ChevronLeft',
        },
      },
    }));

    expectValidTypeScript(result.code);
    expect(result).toEqual({
      code: [
        'import { Button, Icon } from "@tashilcar/swiss-army-knife";',
        '',
        '<Button renderRightIcon={<Icon name="plus" />} iconOnly />',
      ].join('\n'),
      diagnostics: [],
    });
  });

  it('golden: multiline text children retain their exact whitespace', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    };

    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { label: 'First line\nSecond line' },
    }))).toBe(
      [
        'import { Button } from "tashil-ui";',
        '',
        '<Button>',
        '  {"First line\\nSecond line"}',
        '</Button>',
      ].join('\n'),
    );
  });

  it('golden: many props expand to one-per-line', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: {
        a: { x: { prop: 'a', value: 1 } },
        b: { x: { prop: 'b', value: 2 } },
        c: { x: { prop: 'c', value: 3 } },
        d: { x: { prop: 'd', value: 4 } },
      },
    };
    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { a: 'x', b: 'x', c: 'x', d: 'x' },
    }))).toBe(
      [
        'import { Button } from "tashil-ui";',
        '',
        '<Button',
        '  a={1}',
        '  b={2}',
        '  c={3}',
        '  d={4}',
        '>',
        '  Button',
        '</Button>',
      ].join('\n'),
    );
  });

  it('golden: icon-only component imports and renders its configured icon', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      childrenTextProperty: 'label',
      iconComponentName: 'TrashIcon',
      iconImportPath: 'tashil-ui',
    };
    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { label: 'Delete' },
      displayText: 'IconButton',
    }))).toBe(
      [
        'import { IconButton, TrashIcon } from "tashil-ui";',
        '',
        '<IconButton aria-label={"Delete"}>',
        '  <TrashIcon />',
        '</IconButton>',
      ].join('\n'),
    );
  });

  it('lets the generated icon aria-label override a mapped target', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      childrenTextProperty: 'label',
      iconComponentName: 'TrashIcon',
      iconImportPath: 'tashil-ui',
      propMappings: {
        Accessibility: {
          Enabled: { prop: 'aria-label', value: 'Mapped label' },
        },
      },
    }, selection({
      componentProperties: { Accessibility: 'Enabled', label: 'Generated label' },
    }));

    expect(result.code.match(/aria-label=/g)).toHaveLength(1);
    expect(result.code).toContain('aria-label={"Generated label"}');
    expect(result.code).not.toContain('Mapped label');
    expect(result.diagnostics).toContainEqual({
      kind: 'reserved-target',
      prop: 'aria-label',
      sources: [{ figmaProperty: 'Accessibility', figmaValue: 'Enabled' }],
    });
    expectValidTypeScript(result.code);
  });

  it('omits a mapped children prop when icon mode renders its icon child', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: 'TrashIcon',
      iconImportPath: 'tashil-ui',
      propMappings: {
        Content: { Shown: { prop: 'children', value: 'Mapped child' } },
      },
    }, selection({
      componentProperties: { Content: 'Shown', label: 'Delete' },
    }));

    expect(result.code).not.toContain('children=');
    expect(result.code).toContain('  <TrashIcon />');
    expect(result.diagnostics).toContainEqual({
      kind: 'reserved-target',
      prop: 'children',
      sources: [{ figmaProperty: 'Content', figmaValue: 'Shown' }],
    });
    expectValidTypeScript(result.code);
  });

  it('emits a separate icon import without duplicating a coincident named import', () => {
    const separateImport = createValidUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: 'TrashIcon',
      iconImportPath: 'tashil-icons',
    }, selection({ componentProperties: { label: 'Delete' } }));
    expect(separateImport).toContain([
      'import { IconButton } from "tashil-ui";',
      'import { TrashIcon } from "tashil-icons";',
    ].join('\n'));

    const coincidentImport = createValidUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Glyph',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: 'Glyph',
      iconImportPath: 'tashil-ui',
    }, selection({ componentProperties: { label: 'Glyph' } }));
    expect(coincidentImport.match(/import \{ Glyph \}/g)).toHaveLength(1);
  });

  it('golden: no-children mode emits self-closing JSX with multiline props', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Divider',
      importPath: 'tashil-ui',
      childrenMode: 'none',
      propMappings: {
        a: { x: { prop: 'a', value: 1 } },
        b: { x: { prop: 'b', value: 2 } },
        c: { x: { prop: 'c', value: 3 } },
        d: { x: { prop: 'd', value: 4 } },
      },
    };
    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { a: 'x', b: 'x', c: 'x', d: 'x' },
    }))).toBe([
      'import { Divider } from "tashil-ui";',
      '',
      '<Divider',
      '  a={1}',
      '  b={2}',
      '  c={3}',
      '  d={4}',
      '/>',
    ].join('\n'));
  });

  it('emits inline self-closing JSX when no-children mode has a few props', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Divider',
      importPath: 'tashil-ui',
      childrenMode: 'none',
      propMappings: {
        tone: { subtle: { prop: 'tone', value: 'subtle' } },
      },
    }, selection({ componentProperties: { tone: 'subtle' } }));

    expect(result.code).toContain('<Divider tone={"subtle"} />');
    expectValidTypeScript(result.code);
  });

  it('omits a mapped children prop so no-children mode remains childless', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Divider',
      importPath: 'tashil-ui',
      childrenMode: 'none',
      propMappings: {
        Content: { Shown: { prop: 'children', value: 'Mapped child' } },
      },
    }, selection({ componentProperties: { Content: 'Shown' } }));

    expect(result.code).toContain('<Divider />');
    expect(result.code).not.toContain('children=');
    expect(result.diagnostics).toContainEqual({
      kind: 'reserved-target',
      prop: 'children',
      sources: [{ figmaProperty: 'Content', figmaValue: 'Shown' }],
    });
    expectValidTypeScript(result.code);
  });

  it('golden: label with special characters is wrapped as a string expression', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Tag',
      importPath: 'tashil-ui',
    };
    expect(createValidUsageSnippet(metadata, selection({
      componentProperties: { label: 'A & B < {x}' },
      displayText: 'A & B < {x}',
    }))).toBe(
      [
        'import { Tag } from "tashil-ui";',
        '',
        '<Tag>',
        '  {"A & B < {x}"}',
        '</Tag>',
      ].join('\n'),
    );
  });

  // ---- Behavioural coverage around the golden tests ----

  it('uses the componentProperties label when present, falling back to displayText', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    };
    expect(createValidUsageSnippet(metadata, selection({ componentProperties: { label: 'Submit' } })))
      .toContain('  Submit');
  });

  it('omits a mapped children prop when text mode renders text children', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenMode: 'text',
      propMappings: {
        Content: { Shown: { prop: 'children', value: 'Mapped child' } },
      },
    }, selection({
      componentProperties: { Content: 'Shown', label: 'Generated child' },
    }));

    expect(result.code).not.toContain('children=');
    expect(result.code).toContain('  Generated child');
    expect(result.diagnostics).toContainEqual({
      kind: 'reserved-target',
      prop: 'children',
      sources: [{ figmaProperty: 'Content', figmaValue: 'Shown' }],
    });
    expectValidTypeScript(result.code);
  });

  it.each(['text', 'none'] as const)(
    'keeps mapped aria-label valid in %s mode',
    (childrenMode) => {
      const metadata: ConnectionMetadata = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
        childrenMode,
        ...(childrenMode === 'text' ? { childrenTextProperty: 'label' } : {}),
        propMappings: {
          Accessibility: {
            Enabled: { prop: 'aria-label', value: 'Mapped label' },
          },
        },
      };
      const result = createUsageSnippet(metadata, selection({
        componentProperties: {
          Accessibility: 'Enabled',
          ...(childrenMode === 'text' ? { label: 'Button' } : {}),
        },
      }));

      expect(result.code).toContain('aria-label={"Mapped label"}');
      expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
        kind: 'reserved-target',
        prop: 'aria-label',
      }));
      expectValidTypeScript(result.code);
    },
  );

  it('uses a configurable text property with a case-insensitive fallback', () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenTextProperty: 'button text',
    };
    const result = createUsageSnippet(metadata, selection({
      componentProperties: { 'Button Text': 'Continue', label: 'Ignored' },
    }));

    expect(result.code).toContain('  Continue');
    expect(result.diagnostics).toContainEqual({
      figmaProperty: 'label',
      figmaValue: 'Ignored',
      kind: 'unmapped-property',
    });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      figmaProperty: 'Button Text',
      kind: 'unmapped-property',
    }));
  });

  it('falls back to label and consumes it when the configured text property is absent', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenTextProperty: 'Button Text',
    }, selection({
      componentProperties: { label: 'متن دکمه' },
      displayText: 'Fallback layer name',
    }));

    expect(result.code).toContain('  متن دکمه');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      figmaProperty: 'label',
      kind: 'unmapped-property',
    }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      kind: 'missing-children-source',
    }));
  });

  it('falls back to displayText and emits a typed diagnostic when the source is absent', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenTextProperty: 'Button Text',
    }, selection({ displayText: 'Fallback label' }));

    expect(result.code).toContain('  Fallback label');
    expect(result.diagnostics).toContainEqual({
      figmaProperty: 'Button Text',
      kind: 'missing-children-source',
    });
    expect(formatMappingDiagnostics(result.diagnostics)).toMatch(/selected layer text\/name/i);
  });

  it('resolves exact properties before case-insensitive alternatives', () => {
    expect(resolveChildrenText(selection({
      componentProperties: { Label: 'Case insensitive', label: 'Exact' },
    }), 'label')).toEqual({ sourceProperty: 'label', text: 'Exact' });
  });

  it('case-insensitively resolves names that exist only on the object prototype', () => {
    expect(resolveChildrenText(selection({
      componentProperties: { TOSTRING: 'Own label' },
    }), 'toString')).toEqual({ sourceProperty: 'TOSTRING', text: 'Own label' });
  });

  it('safely serializes quotes, backslashes, newlines, and import paths', () => {
    const importPath = 'tashil-"ui\\components\nbutton';
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath,
      propMappings: {
        title: { quote: { prop: 'title', value: 'say "hi" \\done\nnext' } },
      },
    };
    const snippet = createValidUsageSnippet(metadata, selection({
      componentProperties: { title: 'quote' },
    }));

    expect(snippet).toContain(`from ${JSON.stringify(importPath)};`);
    expect(snippet).toContain('title={"say \\"hi\\" \\\\done\\nnext"}');
  });

  it('keeps TSX pastable while returning mapping diagnostics separately', () => {
    const result = createUsageSnippet({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: {
        Size: { Small: { prop: 'size', value: 'sm' } },
      },
    }, selection({ componentProperties: { Size: 'Large', label: 'Button' } }));

    expect(result.diagnostics).toEqual([{
      figmaProperty: 'Size',
      figmaValue: 'Large',
      kind: 'unmapped-value',
    }]);
    expect(result.code).not.toContain('No mapping');
    expectValidTypeScript(result.code);
  });
});

describe('isConnectionMetadata', () => {
  it('accepts a minimal valid connection', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    })).toBe(true);
  });

  it('accepts optional reference strings without treating them as codegen inputs', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourcePath: 'src/Button.tsx',
      sourceUrl: 'https://github.example/Button.tsx',
      storybookUrl: 'https://storybook.example/Button',
    })).toBe(true);

    // Read-time validation stays structural so an old unsafe reference cannot
    // prevent otherwise valid TSX from being generated.
    expect(validateConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      storybookUrl: 'javascript:legacy-reference',
    })).toEqual({ ok: true });
  });

  it('rejects non-string source URLs', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourceUrl: 42,
    })).toBe(false);
  });

  it('rejects when componentName is missing or empty', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      importPath: 'tashil-ui',
    })).toBe(false);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: '',
      importPath: 'tashil-ui',
    })).toBe(false);
  });

  it('rejects invalid component and prop identifiers', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button;alert(1)',
      importPath: 'tashil-ui',
    }))
      .toBe(false);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'button',
      importPath: 'tashil-ui',
    }))
      .toBe(false);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: { intent: { primary: { prop: 'intent={evil}', value: 'primary' } } },
    })).toBe(false);
  });

  it('validates text, icon-only, and no-children configurations', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: 'TrashIcon',
      iconImportPath: 'tashil-icons',
    })).toBe(true);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Divider',
      importPath: 'tashil-ui',
      childrenMode: 'none',
    })).toBe(true);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenMode: 'icon',
    })).toBe(false);
  });

  it('rejects missing or conflicting icon imports and empty text sources', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
    })).toBe(false);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: 'IconButton',
      iconImportPath: 'tashil-icons',
    })).toBe(false);
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      childrenTextProperty: '   ',
    })).toBe(false);
  });

  it('rejects when importPath is missing', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
    })).toBe(false);
  });

  it('rejects malformed propMappings', () => {
    expect(isConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
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

  it('rejects missing, legacy, malformed, and future runtime schema versions', () => {
    const base = { componentName: 'Button', importPath: 'tashil-ui' };

    expect(isConnectionMetadata(base)).toBe(false);
    expect(isConnectionMetadata({ ...base, schemaVersion: 2 })).toBe(false);
    expect(isConnectionMetadata({ ...base, schemaVersion: 3.5 })).toBe(false);
    expect(isConnectionMetadata({ ...base, schemaVersion: 4 })).toBe(false);
  });
});

describe('validateConnectionMetadata', () => {
  it('returns ok for valid metadata', () => {
    expect(validateConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    }))
      .toEqual({ ok: true });
  });

  it('returns a message for invalid metadata', () => {
    const result = validateConnectionMetadata({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: '',
      importPath: '',
    });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/component name/i);
  });
});

describe('persisted connection metadata', () => {
  const legacyBase = {
    componentName: 'Button',
    importPath: 'tashil-ui',
    sourcePath: 'src/Button.tsx',
  };

  it.each([
    ['missing version', legacyBase],
    ['explicit v1', { ...legacyBase, schemaVersion: 1 }],
  ])('maps %s to legacy v1 and migrates it to current text metadata', (_label, value) => {
    const validation = validatePersistedConnectionMetadata(value);

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error(validation.issue.message);
    }

    expect(validation.metadata.schemaVersion).toBe(1);
    expect(migratePersistedConnectionMetadata(validation.metadata)).toEqual({
      ...value,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'text',
      childrenTextProperty: 'label',
    });
  });

  it.each([
    {
      childrenMode: 'text',
      expected: {
        childrenMode: 'text',
        childrenTextProperty: 'label',
      },
    },
    {
      childrenMode: 'icon-only',
      expected: {
        childrenMode: 'icon-only',
        childrenTextProperty: 'label',
        iconComponentName: 'Icon',
        iconImportPath: 'tashil-ui',
      },
    },
  ] as const)('migrates supported v2 $childrenMode metadata', ({ childrenMode, expected }) => {
    const validation = validatePersistedConnectionMetadata({
      ...legacyBase,
      childrenMode,
      schemaVersion: 2,
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error(validation.issue.message);
    }

    expect(migratePersistedConnectionMetadata(validation.metadata)).toEqual({
      ...legacyBase,
      ...expected,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  it('passes valid current v3 metadata through without accepting it as legacy', () => {
    const current: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Divider',
      importPath: 'tashil-ui',
    };
    const validation = validatePersistedConnectionMetadata(current);

    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error(validation.issue.message);
    }

    expect(validation.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migratePersistedConnectionMetadata(validation.metadata)).toBe(current);
  });

  it.each([
    ['string', '3'],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s schema version as invalid', (_label, schemaVersion) => {
    expect(validatePersistedConnectionMetadata({ ...legacyBase, schemaVersion })).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({ reason: 'invalid-schema-version' }),
        ok: false,
      }),
    );
  });

  it('rejects a future integer version instead of treating it as current', () => {
    expect(validatePersistedConnectionMetadata({
      ...legacyBase,
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    })).toEqual(expect.objectContaining({
      issue: expect.objectContaining({
        message: expect.stringMatching(/newer.*update the plugin/i),
        reason: 'future-schema-version',
      }),
      ok: false,
    }));
  });

  it.each([
    ['v1 with a v2 field', { ...legacyBase, childrenMode: 'text', schemaVersion: 1 }],
    ['v2 none mode', { ...legacyBase, childrenMode: 'none', schemaVersion: 2 }],
    ['v2 with a v3 field', {
      ...legacyBase,
      childrenMode: 'text',
      childrenTextProperty: 'label',
      schemaVersion: 2,
    }],
    ['invalid v3 shape', {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'button',
      importPath: 'tashil-ui',
    }],
  ])('rejects $0 as version-specific invalid metadata', (_label, value) => {
    expect(validatePersistedConnectionMetadata(value)).toEqual(expect.objectContaining({
      issue: expect.objectContaining({ reason: 'invalid-metadata' }),
      ok: false,
    }));
  });

  it.each([null, [], 'metadata'])('rejects a non-object persisted root', (value) => {
    expect(validatePersistedConnectionMetadata(value)).toEqual(expect.objectContaining({
      issue: expect.objectContaining({ reason: 'invalid-root' }),
      ok: false,
    }));
  });
});
