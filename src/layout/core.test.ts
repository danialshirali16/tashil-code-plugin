import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import {
  resolveClassNames,
  toClassName,
  toComponentName,
} from './naming';
import { collectByPath, renderImportLines } from './imports';
import { formatLength, renderCssModule, renderLayoutDeclarations } from './css-module-emitter';
import { renderTsx } from './tsx-emitter';
import { generateLayout } from './generate-layout';
import type {
  ComponentImport,
  CompositionNode,
  LayoutDocument,
  LayoutStyle,
} from './types';

function expectValidTypeScript(source: string): void {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'generated.tsx',
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  expect(errors).toEqual([]);
}

function imports(
  importedName: string,
  modulePath: string,
  localName: string = importedName,
): ComponentImport {
  return { importedName, localName, modulePath };
}

function style(overrides: Partial<LayoutStyle> = {}): LayoutStyle {
  return {
    axis: 'vertical',
    wrap: false,
    gap: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('naming', () => {
  describe('toComponentName', () => {
    it('PascalCases a simple layer name', () => {
      expect(toComponentName('payment form')).toBe('PaymentForm');
    });

    it('handles slashes and separators', () => {
      expect(toComponentName('Checkout / Payment')).toBe('CheckoutPayment');
    });

    it('preserves existing PascalCase', () => {
      expect(toComponentName('PaymentDetails')).toBe('PaymentDetails');
    });

    it('falls back to GeneratedLayout for empty input', () => {
      expect(toComponentName('')).toBe('GeneratedLayout');
      expect(toComponentName('   /   ')).toBe('GeneratedLayout');
    });

    it('prefixes a leading digit so the identifier is legal', () => {
      expect(toComponentName('1 / 2')).toBe('Layer12');
    });
  });

  describe('toClassName', () => {
    it('kebab-cases a CamelCase name', () => {
      expect(toClassName('PageHeader')).toBe('page-header');
    });

    it('collapses non-identifier runs to dashes', () => {
      expect(toClassName('Filter chips / row')).toBe('filter-chips-row');
    });

    it('falls back to "layer" for empty input', () => {
      expect(toClassName('')).toBe('layer');
      expect(toClassName('!!!')).toBe('layer');
    });
  });

  describe('resolveClassNames', () => {
    it('keeps bare names when there is no collision', () => {
      const map = resolveClassNames([
        { nodeId: '1', name: 'Header' },
        { nodeId: '2', name: 'Body' },
      ]);
      expect(map.get('1')).toBe('header');
      expect(map.get('2')).toBe('body');
    });

    it('suffixes the second collision with -2', () => {
      const map = resolveClassNames([
        { nodeId: '1', name: 'Card' },
        { nodeId: '2', name: 'Card' },
      ]);
      expect(map.get('1')).toBe('card');
      expect(map.get('2')).toBe('card-2');
    });

    it('increments the suffix for further collisions', () => {
      const map = resolveClassNames([
        { nodeId: '1', name: 'Card' },
        { nodeId: '2', name: 'Card' },
        { nodeId: '3', name: 'Card' },
      ]);
      expect(map.get('3')).toBe('card-3');
    });

    it('leaves an unrelated name untouched even with collisions elsewhere', () => {
      const map = resolveClassNames([
        { nodeId: '1', name: 'Card' },
        { nodeId: '2', name: 'Badge' },
        { nodeId: '3', name: 'Card' },
      ]);
      expect(map.get('2')).toBe('badge');
      expect(map.get('3')).toBe('card-2');
    });
  });
});

describe('imports', () => {
  describe('renderImportLines', () => {
    it('renders a single named import', () => {
      expect(renderImportLines([imports('Button', '@tashilcar/ui')]))
        .toBe('import { Button } from "@tashilcar/ui";');
    });

    it('deduplicates the same name and path', () => {
      expect(renderImportLines([
        imports('Button', '@tashilcar/ui'),
        imports('Button', '@tashilcar/ui'),
      ])).toBe('import { Button } from "@tashilcar/ui";');
    });

    it('groups multiple names from one path, insertion order', () => {
      expect(renderImportLines([
        imports('Button', '@tashilcar/ui'),
        imports('Icon', '@tashilcar/ui'),
      ])).toBe('import { Button, Icon } from "@tashilcar/ui";');
    });

    it('emits one line per distinct path, in insertion order', () => {
      expect(renderImportLines([
        imports('IconButton', 'tashil-ui'),
        imports('TrashIcon', 'tashil-icons'),
      ])).toBe([
        'import { IconButton } from "tashil-ui";',
        'import { TrashIcon } from "tashil-icons";',
      ].join('\n'));
    });

    it('resolves same name from different paths with a deterministic alias', () => {
      // The first Card owns the bare name; the second is aliased to Card2.
      const lines = renderImportLines([
        imports('Card', '@tashilcar/ui'),
        imports('Card', '@tashilcar/forms'),
      ]);
      expect(lines).toBe([
        'import { Card } from "@tashilcar/ui";',
        'import { Card as Card2 } from "@tashilcar/forms";',
      ].join('\n'));
    });
  });

  describe('collectByPath', () => {
    it('reports the localName alias chosen for each entry', () => {
      const map = collectByPath([
        imports('Card', '@tashilcar/ui'),
        imports('Card', '@tashilcar/forms'),
        imports('Card', '@tashilcar/ui'),
      ]);
      const ui = map.get('@tashilcar/ui')!;
      const forms = map.get('@tashilcar/forms')!;
      expect(ui.map((e) => e.localName)).toEqual(['Card', 'Card']);
      expect(forms.map((e) => e.localName)).toEqual(['Card2']);
    });
  });
});

describe('css-module-emitter', () => {
  describe('formatLength', () => {
    it('emits bare integer pixels', () => {
      expect(formatLength(0)).toBe('0px');
      expect(formatLength(24)).toBe('24px');
    });

    it('rounds fractional values to two decimals', () => {
      expect(formatLength(12.5)).toBe('12.5px');
      expect(formatLength(12.567)).toBe('12.57px');
    });

    it('guards against non-finite values', () => {
      expect(formatLength(Number.NaN)).toBe('0px');
      expect(formatLength(Number.POSITIVE_INFINITY)).toBe('0px');
    });
  });

  describe('renderLayoutDeclarations', () => {
    // renderLayoutDeclarations returns the raw lines; join for string assertions.
    const decls = (s: LayoutStyle): string => renderLayoutDeclarations(s).join('\n');

    it('emits a vertical flex column', () => {
      const css = decls(style({ axis: 'vertical' }));
      expect(css).toContain('display: flex;');
      expect(css).toContain('flex-direction: column;');
    });

    it('emits a horizontal flex row', () => {
      const css = decls(style({ axis: 'horizontal' }));
      expect(css).toContain('flex-direction: row;');
    });

    it('emits gap only when positive', () => {
      expect(decls(style({ gap: 16 }))).toContain('gap: 16px;');
      expect(decls(style({ gap: 0 }))).not.toContain('gap:');
    });

    it('emits flex-wrap when wrapping', () => {
      expect(decls(style({ wrap: true }))).toContain('flex-wrap: wrap;');
    });

    it('splits gap into row/column-gap when wrapping with a counter gap', () => {
      const css = decls(style({
        axis: 'horizontal', wrap: true, gap: 8, counterGap: 12,
      }));
      expect(css).toContain('column-gap: 8px;');
      expect(css).toContain('row-gap: 12px;');
      expect(css).not.toMatch(/^\s+gap:/m);
    });

    it('omits justify-content for the default flex-start', () => {
      expect(decls(style({ justifyContent: 'flex-start' })))
        .not.toContain('justify-content');
      expect(decls(style({ justifyContent: 'center' })))
        .toContain('justify-content: center;');
    });

    it('omits align-items for the default stretch', () => {
      expect(decls(style({ alignItems: 'stretch' })))
        .not.toContain('align-items');
      expect(decls(style({ alignItems: 'center' })))
        .toContain('align-items: center;');
    });

    it('collapses equal padding to a single value', () => {
      expect(decls(style({
        paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
      }))).toContain('padding: 24px;');
    });

    it('collapses symmetric padding to two values', () => {
      expect(decls(style({
        paddingTop: 16, paddingRight: 8, paddingBottom: 16, paddingLeft: 8,
      }))).toContain('padding: 16px 8px;');
    });

    it('emits the full four-value form when all sides differ', () => {
      expect(decls(style({
        paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4,
      }))).toContain('padding: 1px 2px 3px 4px;');
    });
  });

  describe('renderCssModule', () => {
    it('emits one rule per container in document order', () => {
      const doc: LayoutDocument = {
        name: 'Form',
        diagnostics: [],
        root: {
          kind: 'container',
          nodeId: 'n1',
          layerPath: ['Form'],
          className: 'form',
          element: 'div',
          layout: style({ axis: 'vertical', gap: 16 }),
          children: [
            {
              kind: 'container',
              nodeId: 'n2',
              layerPath: ['Form', 'Row'],
              className: 'row',
              element: 'div',
              layout: style({ axis: 'horizontal', gap: 8 }),
              children: [],
            },
          ],
        },
      };
      const css = renderCssModule(doc);
      expect(css).toBe([
        '.form {',
        '  display: flex;',
        '  flex-direction: column;',
        '  gap: 16px;',
        '}',
        '',
        '.row {',
        '  display: flex;',
        '  flex-direction: row;',
        '  gap: 8px;',
        '}',
        '',
      ].join('\n'));
    });

    it('emits nothing for a document with no containers', () => {
      const doc: LayoutDocument = {
        name: 'Text',
        diagnostics: [],
        root: { kind: 'text', nodeId: 't', layerPath: ['T'], text: 'Hi' },
      };
      expect(renderCssModule(doc)).toBe('');
    });
  });
});

describe('tsx-emitter', () => {
  function componentNode(jsx: string): CompositionNode {
    return {
      kind: 'component',
      nodeId: 'c1',
      layerPath: ['Comp'],
      usage: { imports: [imports('Button', '@tashilcar/ui')], jsx, diagnostics: [] },
    };
  }

  it('renders an import block, css import, and an exported function', () => {
    const doc: LayoutDocument = {
      name: 'Payment details',
      diagnostics: [],
      root: {
        kind: 'container',
        nodeId: 'n1',
        layerPath: ['Payment details'],
        className: 'payment',
        element: 'div',
        layout: style({ axis: 'vertical' }),
        children: [componentNode('<Button>Continue</Button>')],
      },
    };
    const tsx = renderTsx(doc, './PaymentDetails.module.css');
    expectValidTypeScript(tsx);
    expect(tsx).toContain('import { Button } from "@tashilcar/ui";');
    expect(tsx).toContain('import styles from "./PaymentDetails.module.css";');
    expect(tsx).toContain('export function PaymentDetails() {');
    expect(tsx).toContain('<div className={styles.payment}>');
    expect(tsx).toContain('<Button>Continue</Button>');
  });

  it('renders a bare text node without a wrapper span', () => {
    const doc: LayoutDocument = {
      name: 'Caption',
      diagnostics: [],
      root: { kind: 'text', nodeId: 't', layerPath: ['Caption'], text: 'Hello' },
    };
    const tsx = renderTsx(doc, './Caption.module.css');
    expectValidTypeScript(tsx);
    expect(tsx).toContain('Hello');
    expect(tsx).not.toContain('<span');
  });

  it('escapes text that is unsafe as bare JSX', () => {
    const doc: LayoutDocument = {
      name: 'Caption',
      diagnostics: [],
      root: { kind: 'text', nodeId: 't', layerPath: ['Caption'], text: 'Tom & Jerry' },
    };
    expect(renderTsx(doc, './Caption.module.css')).toContain('{"Tom & Jerry"}');
  });

  it('renders a placeholder as an inline JSX comment', () => {
    const doc: LayoutDocument = {
      name: 'X',
      diagnostics: [],
      root: {
        kind: 'placeholder',
        nodeId: 'p',
        layerPath: ['X'],
        reason: 'unsupported-node',
        label: 'Vector divider',
      },
    };
    const tsx = renderTsx(doc, './X.module.css');
    expectValidTypeScript(tsx);
    expect(tsx).toContain('{/* Vector divider */}');
  });

  it('escapes a comment body that would otherwise close the comment', () => {
    const doc: LayoutDocument = {
      name: 'X',
      diagnostics: [],
      root: {
        kind: 'placeholder',
        nodeId: 'p',
        layerPath: ['X'],
        reason: 'unsupported-node',
        label: 'a */ b',
      },
    };
    expect(renderTsx(doc, './X.module.css')).not.toContain('a */ b');
  });

  it('renders a self-closing div for an empty container', () => {
    const doc: LayoutDocument = {
      name: 'Empty',
      diagnostics: [],
      root: {
        kind: 'container',
        nodeId: 'n',
 layerPath: ['Empty'],
        className: 'empty',
        element: 'div',
        layout: style(),
        children: [],
      },
    };
    expect(renderTsx(doc, './Empty.module.css')).toContain('<div className={styles.empty} />');
  });
});

describe('generateLayout', () => {
  it('counts components and wrappers and carries diagnostics', () => {
    const doc: LayoutDocument = {
      name: 'Form',
      diagnostics: [
        { severity: 'info', reason: 'root-fixed-size-omitted', message: 'omitted width' },
      ],
      root: {
        kind: 'container',
        nodeId: 'n1',
        layerPath: ['Form'],
        className: 'form',
        element: 'div',
        layout: style({ axis: 'vertical', gap: 16 }),
        children: [
          {
            kind: 'component',
            nodeId: 'c1',
            layerPath: ['Form', 'Button'],
            usage: {
              imports: [imports('Button', '@tashilcar/ui')],
              jsx: '<Button>Go</Button>',
              diagnostics: [],
            },
          },
          {
            kind: 'placeholder',
            nodeId: 'p1',
            layerPath: ['Form', 'Divider'],
            reason: 'unsupported-node',
            label: 'Vector',
          },
        ],
      },
    };

    const result = generateLayout(doc, './Form.module.css');
    expectValidTypeScript(result.tsx);
    expect(result.componentCount).toBe(1);
    expect(result.wrapperCount).toBe(1);
    expect(result.diagnostics).toEqual(doc.diagnostics);
    expect(result.css).toContain('.form {');
  });

  it('produces identical output for the same document (determinism)', () => {
    const doc: LayoutDocument = {
      name: 'Form',
      diagnostics: [],
      root: {
        kind: 'container',
        nodeId: 'n1',
        layerPath: ['Form'],
        className: 'form',
        element: 'div',
        layout: style({ gap: 8 }),
        children: [],
      },
    };
    const a = generateLayout(doc, './Form.module.css');
    const b = generateLayout(doc, './Form.module.css');
    expect(a.tsx).toBe(b.tsx);
    expect(a.css).toBe(b.css);
  });
});
