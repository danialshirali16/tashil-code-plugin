import { describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import * as ts from 'typescript';
import { createUsageSnippet } from '../codegen';
import { createSemanticNodeTree } from '../semantic/figma-adapter';
import { extractFigmaSemanticSnapshot } from '../semantic/figma-extractor';
import { createDialogNode, createDialogRecipe } from '../semantic/fixtures';
import { resolveSemanticUsage } from '../semantic/resolver';
import { inspectFrame } from '../inspect/inspect-frame';
import {
  extractLayout,
  type ExtractLayoutOptions,
} from './figma-layout-extractor';
import {
  absolutePositionedChild,
  brokenInstance,
  component,
  connection,
  duplicateNamesAcrossPackages,
  frame,
  instance,
  line,
  nestedAutoLayout,
  rawText,
  text,
  unconnectedInstance,
  unsupportedVector,
  vector,
  verticalForm,
  fixtures,
} from './fixtures';
import { GenerationContext } from './generation-context';
import { generateLayout } from './generate-layout';

function generate(
  node: Parameters<typeof extractLayout>[0],
  options: ExtractLayoutOptions = {},
) {
  return extractLayout(node, options).then((document) =>
    generateLayout(document));
}

function expectValidTsx(source: string): void {
  const generatedPath = '/generated-layout.tsx';
  const declarationsPath = '/generated-modules.d.ts';
  const compilerOptions: ts.CompilerOptions = {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const declarations = createGeneratedModuleDeclarations(source);
  const virtualFiles = new Map([
    [generatedPath, source],
    [declarationsPath, declarations],
  ]);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (fileName) => virtualFiles.get(fileName) ?? readFile(fileName);
  host.fileExists = (fileName) =>
    virtualFiles.has(fileName) || fileExists(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const contents = virtualFiles.get(fileName);
    return contents === undefined
      ? getSourceFile(fileName, languageVersion)
      : ts.createSourceFile(fileName, contents, languageVersion, true);
  };
  const program = ts.createProgram(
    [generatedPath, declarationsPath],
    compilerOptions,
    host,
  );
  const errors = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

  expect(errors).toEqual([]);
  expectValidStyledCss(source);
}

function createGeneratedModuleDeclarations(source: string): string {
  const names = new Set<string>();
  const imports = source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']@tashilcar\/swiss-army-knife["']/g,
  );
  for (const match of imports) {
    for (const specifier of match[1].split(',')) {
      const imported = specifier.trim().split(/\s+as\s+/)[0];
      if (imported) {
        names.add(imported);
      }
    }
  }
  return [
    'declare namespace JSX {',
    '  interface IntrinsicElements { [name: string]: any; }',
    '}',
    'declare module "styled-components" {',
    '  const styled: any;',
    '  export default styled;',
    '}',
    'declare module "styles/colors" {',
    '  const colors: any;',
    '  export default colors;',
    '}',
    'declare module "@tashilcar/swiss-army-knife" {',
    ...Array.from(names, (name) => `  export const ${name}: any;`),
    '}',
  ].join('\n');
}

function expectValidStyledCss(source: string): void {
  const templates = source.matchAll(/styled\.[A-Za-z][A-Za-z0-9]*`([\s\S]*?)`/g);
  for (const match of templates) {
    const css = match[1].replace(/\$\{[^}]+\}/g, 'token');
    expect(() => postcss.parse(`.generated {${css}}`)).not.toThrow();
  }
}

describe('full React layout generation', () => {
  it.each(Object.entries(fixtures))(
    'matches the deterministic %s roadmap fixture snapshot',
    async (_name, createFixture) => {
      const generated = await generate(createFixture());
      expect({
        componentCount: generated.componentCount,
        componentName: generated.componentName,
        diagnostics: generated.diagnostics,
        fidelity: generated.fidelity,
        runtimeRequirements: generated.runtimeRequirements,
        tsx: generated.tsx,
        wrapperCount: generated.wrapperCount,
      }).toMatchSnapshot();
    },
  );

  it('generates a complete frame component with connected children and styled-components', async () => {
    const generated = await generate(verticalForm());

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain('export function PaymentForm()');
    expect(generated.tsx).toContain('import styled from "styled-components";');
    expect(generated.tsx).toContain('const PaymentFormRoot = styled.div`');
    expect(generated.tsx).toContain('<PaymentFormRoot>');
    expect(generated.tsx).toContain('<TextField');
    expect(generated.tsx).toContain('<Button');
    expect(generated.tsx).toContain('from "@tashilcar/swiss-army-knife";');
    expect(generated.tsx).toContain('flex-direction: column;');
    expect(generated.tsx).toContain('gap: 16px;');
    expect(generated.tsx).toContain('const ButtonSubmitWrapper = styled.div`');
    expect(generated.tsx).toContain('width: 100%;');
    expect(generated.componentCount).toBe(2);
  });

  it('keeps nested frame layers in the generated React tree', async () => {
    const generated = await generate(nestedAutoLayout());

    expect(generated.tsx).toContain('const PaymentSectionRoot = styled.div`');
    expect(generated.tsx).toContain('const CardFields = styled.div`');
    expect(generated.tsx).toContain('<CardFields>');
    expect(generated.tsx).toContain('<TextField');
    expect(generated.wrapperCount).toBe(2);
  });

  it('generates a valid React component for a text selection', async () => {
    const generated = await generate(rawText());

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain('export function Caption()');
    expect(generated.tsx).toContain('Add a payment method');
    expect(generated.tsx).not.toContain('import styled');
    expect(generated.tsx).not.toContain('.module.css');
  });

  it('deduplicates equal component names into the Swiss Army Knife import', async () => {
    const generated = await generate(duplicateNamesAcrossPackages());

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain(
      'import { Card } from "@tashilcar/swiss-army-knife";',
    );
    expect(generated.tsx.match(/<Card>/g)).toHaveLength(2);
    expect(generated.tsx).not.toContain('Card2');
  });

  it('renames a layout root that conflicts with an imported component', async () => {
    const button = component(
      'c:button',
      'Button',
      JSON.stringify(connection({ componentName: 'Button' })),
    );
    const generated = await generate(frame('f:button', 'Button', [
      instance('i:button', 'Button', button),
    ]));

    expectValidTsx(generated.tsx);
    expect(generated.componentName).toBe('ButtonLayout');
    expect(generated.tsx).toContain('const ButtonLayoutRoot = styled.div`');
    expect(generated.tsx).toContain('export function ButtonLayout()');
    expect(generated.tsx).toContain('<Button>');
  });

  it('resolves live instance swaps inside a generated layout', async () => {
    vi.stubGlobal('figma', {
      getNodeByIdAsync: (id: string) => Promise.resolve({
        id,
        name: 'CreditCard',
        type: 'COMPONENT',
      }),
    });

    try {
      const metadata = connection({
        childrenMode: 'none',
        componentName: 'Button',
        importPath: '@tashilcar/swiss-army-knife',
        propMappings: {
          leadingIcon: {
            '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
          },
        },
      });
      const button = component(
        'c:button-with-icon',
        'Button',
        JSON.stringify(metadata),
      );
      const generated = await generate(frame('f:icon', 'Icon action', [
        instance('i:icon', 'Icon button', button, {
          componentProperties: {
            'leadingIcon#swap': {
              type: 'INSTANCE_SWAP',
              value: 'credit-card-id',
            },
          },
        }),
      ]));

      expect(generated.tsx).toContain(
        'import { Button, Icon } from "@tashilcar/swiss-army-knife";',
      );
      expect(generated.tsx).toContain(
        '<Button renderRightIcon={<Icon name="credit-card" />} />',
      );
      const standalone = createUsageSnippet(metadata, {
        componentProperties: { leadingIcon: 'credit-card-id' },
        displayText: 'Icon button',
        instanceSwaps: {
          leadingIcon: {
            componentId: 'credit-card-id',
            componentName: 'CreditCard',
          },
        },
      });
      expect(standalone.code).toContain(
        '<Button renderRightIcon={<Icon name="credit-card" />} />',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('matches standalone text overrides for a live nested instance', async () => {
    const metadata = connection({
      childrenMode: 'text',
      componentName: 'Button',
      importPath: '@tashilcar/swiss-army-knife',
    });
    const button = component('c:text-parity', 'Button', JSON.stringify(metadata));
    const generated = await generate(frame('f:text-parity', 'Text parity', [
      instance('i:text-parity', 'Button', button, {
        componentProperties: {
          'label#text': { type: 'TEXT', value: 'Pay now' },
        },
      }),
    ]));
    const standalone = createUsageSnippet(metadata, {
      componentProperties: { label: 'Pay now' },
      displayText: 'Button',
      instanceSwaps: {},
    });

    expect(standalone.code).toContain('  Pay now');
    expect(generated.tsx).toContain('  Pay now');
    expect(generated.tsx).toContain('<Button>');
  });

  it('matches standalone semantic usage for the same live nested instance', async () => {
    const recipe = createDialogRecipe();
    recipe.figmaSnapshot = extractFigmaSemanticSnapshot(
      createDialogNode(),
      'c:semantic-dialog',
    ).snapshot;
    const metadata = connection({
      componentName: 'ConfirmationDialog',
      importPath: '@tashilcar/swiss-army-knife',
      semanticRecipe: recipe,
    });
    const main = component(
      'c:semantic-dialog',
      'Dialog',
      JSON.stringify(metadata),
    );
    const buttonMain = {
      ...component('c:semantic-button', 'Button'),
      key: 'button-main-key',
    } as unknown as ReturnType<typeof component>;
    const base = instance('i:semantic-dialog', 'Dialog', main, {
      componentProperties: {
        intent: { type: 'VARIANT', value: 'Danger' },
      },
    });
    const dialog = {
      ...(base as unknown as Record<string, unknown>),
      children: [
        frame('f:semantic-header', 'Header', [
          text('t:semantic-title', 'Title', 'Delete workspace?'),
          text(
            't:semantic-description',
            'Description',
            'This action cannot be undone.',
          ),
        ]),
        frame('f:semantic-footer', 'Footer', [
          instance('i:semantic-secondary', 'Secondary action', buttonMain, {
            componentProperties: {
              label: { type: 'TEXT', value: 'Cancel' },
            },
          }),
          instance('i:semantic-primary', 'Primary action', buttonMain, {
            componentProperties: {
              label: { type: 'TEXT', value: 'Delete' },
            },
          }),
        ]),
      ],
    } as unknown as SceneNode;

    const generated = await generate(frame('f:semantic', 'Semantic frame', [
      dialog,
    ]));
    const semanticRoot = await createSemanticNodeTree(dialog);
    const standalone = resolveSemanticUsage(
      metadata.componentName,
      metadata.importPath,
      recipe,
      {
        componentProperties: { intent: 'Danger' },
        root: semanticRoot,
      },
    );
    const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

    expect(compact(generated.tsx)).toContain(compact(standalone.usage.jsx));
    expect(generated.tsx).toContain(
      'import { ConfirmationDialog } from "@tashilcar/swiss-army-knife";',
    );
    expect(generated.tsx).toContain('title={"Delete workspace?"}');
    expect(generated.runtimeRequirements).toEqual([
      'Semantic frame / Dialog — onConfirm: () => void',
    ]);
  });

  it('diagnoses invalid and missing nested component metadata', async () => {
    const invalid = component('c:invalid', 'Invalid', '{not-json');
    const generated = await generate(frame('f:broken', 'Broken connections', [
      instance('i:invalid', 'Invalid', invalid),
      ...brokenInstance().children,
    ]));

    expect(generated.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'i:invalid',
        reason: 'invalid-connection',
      }),
      expect.objectContaining({
        nodeId: 'i:broken',
        reason: 'missing-main-component',
      }),
    ]));
  });

  it('matches standalone usage for the same live connected instance', async () => {
    const metadata = connection({
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@tashilcar/swiss-army-knife',
      propMappings: {
        Disabled: {
          true: { prop: 'disabled', value: true },
        },
        Size: {
          Large: { prop: 'size', value: 'lg' },
        },
      },
    });
    const button = component(
      'c:parity',
      'Button',
      JSON.stringify(metadata),
    );
    const liveInstance = instance('i:parity', 'Button', button, {
      componentProperties: {
        'Disabled#boolean': { type: 'BOOLEAN', value: true },
        'Size#variant': { type: 'VARIANT', value: 'Large' },
      },
    });

    const generated = await generate(frame('f:parity', 'Parity frame', [
      liveInstance,
    ]));
    const standalone = createUsageSnippet(metadata, {
      componentProperties: { Disabled: true, Size: 'Large' },
      displayText: 'Button',
      instanceSwaps: {},
    });
    const standaloneJsx = standalone.code.split('\n').slice(-1)[0];

    expect(generated.tsx).toContain(
      'import { Button } from "@tashilcar/swiss-army-knife";',
    );
    expect(standalone.code).toContain(
      'import { Button } from "@tashilcar/swiss-army-knife";',
    );
    expect(standaloneJsx).toBe('<Button disabled size={"lg"} />');
    expect(generated.tsx).toContain(standaloneJsx);
  });

  it('reconstructs non-auto-layout children without an unsupported-layout warning', async () => {
    const freeform = frame(
      'f:free',
      'Freeform card',
      [text('t:title', 'Title', 'Account', {
        x: 24,
        y: 32,
        width: 120,
        height: 20,
      })],
      { layoutMode: 'NONE' },
    );
    const generated = await generate(freeform);

    expect(generated.tsx).toContain('Account');
    expect(generated.tsx).toContain('const FreeformCardRoot = styled.div`');
    expect(generated.tsx).toContain('position: relative;');
    expect(generated.tsx).toContain('height: 200px;');
    expect(generated.tsx).toContain('const Title = styled.span`');
    expect(generated.tsx).toContain('position: absolute;');
    expect(generated.tsx).toContain('left: 24px;');
    expect(generated.tsx).toContain('top: 32px;');
    expect(generated.tsx).toContain('width: 120px;');
    expect(generated.tsx).toContain('height: 20px;');
    expect(generated.tsx).not.toContain('{/* FRAME:');
    expect(generated.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'absolute-positioning' }),
    ]));
    expect(generated.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unsupported-layout-mode' }),
    ]));
  });

  it('generates an absolute ordinary child inside auto layout', async () => {
    const generated = await generate(absolutePositionedChild());

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain('const CardWithBadgeRoot = styled.div`');
    expect(generated.tsx).toContain('display: flex;');
    expect(generated.tsx).toContain('position: relative;');
    expect(generated.tsx).toContain('const Badge = styled.span`');
    expect(generated.tsx).toContain('position: absolute;');
    expect(generated.tsx).toContain('left: 248px;');
    expect(generated.tsx).toContain('top: 16px;');
    expect(generated.tsx).toContain('width: 48px;');
    expect(generated.tsx).toContain('height: 24px;');
    expect(generated.tsx).toContain('<Badge>New</Badge>');
    expect(generated.tsx).not.toContain('{/* FRAME:');
    expect(generated.diagnostics).toEqual([]);
  });

  it('preserves token-aware absolute offsets from Figma CSS', async () => {
    const badge = text('t:offset-token', 'Badge', 'Sale', {
      layoutPositioning: 'ABSOLUTE',
      x: 24,
      y: 16,
    }) as unknown as TextNode & {
      getCSSAsync: () => Promise<Record<string, string>>;
    };
    badge.getCSSAsync = async () => ({
      left: 'var(--spacing-inline-badge, 24px)',
      top: 'var(--spacing-block-badge, 16px)',
    });
    const generated = await generate(frame(
      'f:offset-token',
      'Token offsets',
      [badge],
    ));

    expect(generated.tsx).toContain('left: var(--spacing-inline-badge, 24px);');
    expect(generated.tsx).toContain('top: var(--spacing-block-badge, 16px);');
  });

  it('bounds sibling work, preserves document order, and shares CSS cache with inspection', async () => {
    let active = 0;
    let peak = 0;
    const children = Array.from({ length: 24 }, (_, index) => {
      const child = frame(`f:child:${index}`, `Child ${index}`, [], {
        css: { display: 'flex' },
      }) as unknown as {
        getCSSAsync: () => Promise<Record<string, string>>;
      } & FrameNode;
      child.getCSSAsync = vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { display: 'flex' };
      });
      return child;
    });
    const root = frame('f:concurrent', 'Concurrent layout', children, {
      css: { display: 'flex' },
    }) as unknown as {
      getCSSAsync: () => Promise<Record<string, string>>;
    } & FrameNode;
    const rootCss = vi.fn(async () => ({ display: 'flex' }));
    root.getCSSAsync = rootCss;
    const context = new GenerationContext({ maxConcurrency: 3 });

    const [generated] = await Promise.all([
      generate(root, { context }),
      inspectFrame(root, { context }),
    ]);

    expect(peak).toBeLessThanOrEqual(3);
    expect(rootCss).toHaveBeenCalledTimes(1);
    const positions = children.map((_, index) =>
      generated.tsx.indexOf(`<Child${index} />`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('caches repeated structural token lookups within one generation', async () => {
    const tokenAlias = { id: 'variable:space-md' };
    const loadVariable = vi.fn(async () => ({
      id: tokenAlias.id,
      name: 'spacing/medium',
    }));
    const root = frame('f:tokens', 'Token cache', [], {
      boundVariables: {
        itemSpacing: tokenAlias,
        paddingTop: tokenAlias,
        paddingRight: tokenAlias,
        paddingBottom: tokenAlias,
        paddingLeft: tokenAlias,
      },
      itemSpacing: 16,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });

    const generated = await generate(root, { loadVariable });

    expect(loadVariable).toHaveBeenCalledTimes(1);
    expect(generated.tsx).toContain('var(--spacing-medium, 16px)');
  });

  it('keeps generated TSX and CSS valid for adversarial names, text, tokens, and CSS values', async () => {
    const strangeText = 'He said “hello” </script> ${notCode}\\n';
    const strangeTextNode = text(
      't:fuzz',
      'class default / "title"',
      strangeText,
    ) as unknown as TextNode & {
      getCSSAsync: () => Promise<Record<string, string>>;
    };
    strangeTextNode.getCSSAsync = async () => ({
      color: 'var(--color-text-default, rgb(1 2 3 / 90%))',
      'font-family': '"Inter Variable", system-ui, sans-serif',
      'text-shadow': '0 1px 2px rgb(0 0 0 / 20%)',
    });
    const root = frame('f:fuzz', '123 / checkout 💳', [
      strangeTextNode,
    ], {
      boundVariables: {
        itemSpacing: { id: 'variable:fuzz' },
      },
      itemSpacing: 7,
      css: {
        background: 'linear-gradient(90deg, #fff 0%, rgb(0 0 0 / 10%) 100%)',
      },
    });
    const generated = await generate(root, {
      loadVariable: async () => ({
        id: 'variable:fuzz',
        name: 'Spacing / Weird token_💳',
      }),
    });

    expectValidTsx(generated.tsx);
    expect(generated.componentName).toBe('Layer123Checkout');
    expect(generated.tsx).toContain(JSON.stringify(strangeText));
    expect(generated.tsx).toContain('var(--spacing-weird-token, 7px)');
  });

  it('preserves an unsupported asset as a comment and diagnostic', async () => {
    const generated = await generate(frame('f:asset', 'Asset card', [
      unsupportedVector(),
    ]));

    expect(generated.tsx).toContain('{/* VECTOR: Divider */}');
    expect(generated.diagnostics).toEqual([
      expect.objectContaining({
        nodeId: 'v:divider',
        reason: 'unsupported-paint',
      }),
    ]);
  });

  it('exports a supported visual leaf as an SVG image asset', async () => {
    const generated = await generate(frame('f:asset', 'Asset card', [
      vector('v:logo', 'Company logo', {
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8z"/></svg>',
      }),
    ]));

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain(
      '<img alt="Company logo" src="data:image/svg+xml,',
    );
    expect(generated.tsx).not.toContain('{/* VECTOR: Company logo */}');
    expect(generated.diagnostics).toEqual([]);
  });

  it('renders a CSS-backed line as a styled divider when SVG export is unavailable', async () => {
    const divider = line('l:divider', 'Divider', {
      css: {
        width: '100%',
        height: '1px',
        'background-color': 'var(--color-border-subtle, #e5e7eb)',
      },
      exportError: new Error('Line export is unavailable'),
    });

    const generated = await generate(frame('f:divider', 'Divider row', [divider]));

    expect(generated.tsx).toContain('const Divider = styled.div`');
    expect(generated.tsx).toContain('background-color: ${colors.border.subtle};');
    expect(generated.tsx).toContain('<Divider aria-hidden="true" />');
    expect(generated.tsx).not.toContain('{/* LINE: Divider */}');
    expect(generated.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unsupported-paint' }),
    ]));
  });

  it('renders a monochrome token-bound SVG as a recolorable CSS mask', async () => {
    const closeIcon = vector('v:close', 'Vector', {
      width: 15,
      height: 15,
      x: 4.5,
      y: 4.5,
      svg: [
        '<svg viewBox="0 0 15 15" fill="none">',
        '<path d="M0 0h15v15H0z" fill="#667890"/>',
        '</svg>',
      ].join(''),
      css: {
        width: '15px',
        height: '15px',
        fill: 'var(--color-icon-subtler, #667890)',
      },
    });

    const generated = await generate(frame(
      'f:close',
      'Close',
      [closeIcon],
      {
        layoutMode: 'NONE',
        width: 24,
        height: 24,
        css: { width: '24px', height: '24px' },
      },
    ));

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain('const Vector = styled.span`');
    expect(generated.tsx).toContain('background-color: ${colors.icon.subtler};');
    expect(generated.tsx).toContain('--icon-mask: url("data:image/svg+xml,');
    expect(generated.tsx).toContain(
      '-webkit-mask: var(--icon-mask) center / 100% 100% no-repeat;',
    );
    expect(generated.tsx).toContain(
      'mask: var(--icon-mask) center / 100% 100% no-repeat;',
    );
    expect(generated.tsx.match(/data:image\/svg\+xml/g)).toHaveLength(1);
    expect(generated.tsx).toContain('<Vector aria-hidden="true" />');
    expect(generated.tsx).not.toContain('<Vector alt=');
    expect(generated.tsx).not.toContain('fill: ${colors.icon.subtler};');
    expect(generated.diagnostics).toEqual([]);
  });

  it('keeps multicolor SVGs as images and omits ineffective paint CSS', async () => {
    const multicolorIcon = vector('v:multicolor', 'Multicolor icon', {
      svg: [
        '<svg viewBox="0 0 16 16">',
        '<path d="M0 0h8v16H0z" fill="#ef4444"/>',
        '<path d="M8 0h8v16H8z" fill="#3b82f6"/>',
        '</svg>',
      ].join(''),
      css: {
        fill: 'var(--color-icon-subtler, #667890)',
      },
    });

    const generated = await generate(frame(
      'f:multicolor',
      'Multicolor asset',
      [multicolorIcon],
    ));

    expect(generated.tsx).toContain('<img alt="Multicolor icon"');
    expect(generated.tsx).not.toContain("import colors from 'styles/colors';");
    expect(generated.tsx).not.toContain('fill: ${colors.icon.subtler};');
    expect(generated.tsx).not.toContain('mask-image:');
  });

  it('uses a semantic section element for Figma sections', async () => {
    const sectionNode = {
      ...(frame('s:content', 'Content section', [
        text('t:section-title', 'Title', 'Overview'),
      ]) as unknown as Record<string, unknown>),
      type: 'SECTION',
    } as unknown as Parameters<typeof extractLayout>[0];

    const generated = await generate(sectionNode);

    expectValidTsx(generated.tsx);
    expect(generated.tsx).toContain(
      'const ContentSectionRoot = styled.section`',
    );
    expect(generated.tsx).toContain('<ContentSectionRoot>');
  });

  it('covers connected, unconnected, and ordinary Discount badge layers', async () => {
    const unconnectedMain = component('c:discount-unconnected', 'Discount badge');
    const connectedMain = component(
      'c:discount-connected',
      'Discount badge',
      JSON.stringify(connection({
        childrenMode: 'none',
        componentName: 'DiscountBadge',
      })),
    );
    const unconnected = await generate(frame('f:discount-unconnected', 'Offer card', [
      instance(
        'i:discount-unconnected',
        'Discount badge',
        unconnectedMain,
      ),
    ]));
    const ordinary = await generate(frame('f:discount-ordinary-root', 'Offer card', [
      frame('f:discount-ordinary', 'Discount badge', [
        text('t:discount', 'Label', '20% off'),
      ]),
    ]));
    const connected = await generate(frame('f:discount-connected-root', 'Offer card', [
      instance('i:discount-connected', 'Discount badge', connectedMain),
    ]));

    expect(unconnected.tsx).toContain('{/* FRAME: Discount badge */}');
    expect(ordinary.tsx).toContain('const DiscountBadge = styled.div`');
    expect(ordinary.tsx).toContain('<DiscountBadge>');
    expect(ordinary.tsx).toContain('20% off');
    expect(connected.tsx).toContain(
      'import { DiscountBadge } from "@tashilcar/swiss-army-knife";',
    );
    expect(connected.tsx).toContain('<DiscountBadge />');
  });

  it('preserves an unconnected instance as a visible JSX comment and note', async () => {
    const generated = await generate(unconnectedInstance());

    expect(generated.tsx).toContain('{/* FRAME: Button / Ghost */}');
    expect(generated.diagnostics).toEqual([
      expect.objectContaining({ reason: 'unconnected-instance' }),
    ]);
  });

  it('is deterministic', async () => {
    const first = await generate(verticalForm());
    const second = await generate(verticalForm());
    expect(second).toEqual(first);
  });

  it('preserves token-aware Figma CSS in styled declarations', async () => {
    const tokenized = frame('f:tokens', 'Token card', [], {
      css: {
        display: 'flex',
        color: 'var(--color-text-default, #111827)',
        background: 'var(--colors-background-neutral-default, #fff)',
        'border-color': 'var(--color/border/neutral/default, #e5e7eb)',
        gap: 'var(--spacing-400, 1rem)',
        padding: 'var(--spacing-600, 1.5rem)',
        'border-radius': 'var(--radius-large, 0.75rem)',
        'border-width': 'var(--border-width-default, 1px)',
        filter: 'blur(var(--blur-soft, 4px))',
        'box-shadow': 'var(--shadow-card, 0 4px 12px rgb(0 0 0 / 8%))',
        'font-family': 'var(--font-family-body, Inter, sans-serif)',
        'font-size': 'var(--font-size-body, 1rem)',
        'font-weight': 'var(--font-weight-semibold, 600)',
        'letter-spacing': 'var(--letter-spacing-tight)',
        'line-height': 'var(--line-height-body, 1.5rem)',
        opacity: 'var(--opacity-disabled, 0.5)',
        'text-shadow': 'var(--shadow-text, 0 1px 2px rgb(0 0 0 / 10%))',
      },
    });

    const generated = await generate(tokenized);

    expect(generated.tsx).toContain("import colors from 'styles/colors';");
    expect(generated.tsx).toContain('color: ${colors.text.default};');
    expect(generated.tsx).toContain(
      'background: ${colors.background.neutral.default};',
    );
    expect(generated.tsx).toContain(
      'border-color: ${colors.border.neutral.default};',
    );
    expect(generated.tsx).toContain('gap: var(--spacing-400, 1rem);');
    expect(generated.tsx).toContain('padding: var(--spacing-600, 1.5rem);');
    expect(generated.tsx).toContain(
      'box-shadow: var(--shadow-card, 0 4px 12px rgb(0 0 0 / 8%));',
    );
    expect(generated.tsx).toContain('font-size: var(--font-size-body, 1rem);');
    expect(generated.tsx).toContain(
      'font-family: var(--font-family-body, Inter, sans-serif);',
    );
    expect(generated.tsx).toContain(
      'font-weight: var(--font-weight-semibold, 600);',
    );
    expect(generated.tsx).toContain(
      'line-height: var(--line-height-body, 1.5rem);',
    );
    expect(generated.tsx).toContain(
      'letter-spacing: var(--letter-spacing-tight);',
    );
    expect(generated.tsx).toContain(
      'border-width: var(--border-width-default, 1px);',
    );
    expect(generated.tsx).toContain(
      'border-radius: var(--radius-large, 0.75rem);',
    );
    expect(generated.tsx).toContain(
      'opacity: var(--opacity-disabled, 0.5);',
    );
    expect(generated.tsx).toContain(
      'text-shadow: var(--shadow-text, 0 1px 2px rgb(0 0 0 / 10%));',
    );
    expect(generated.tsx).toContain(
      'filter: blur(var(--blur-soft, 4px));',
    );
  });

  it('preserves the Figma node receiver when loading layout CSS through the cache', async () => {
    const root = frame('f:receiver', 'Receiver card', []) as unknown as FrameNode & {
      getCSSAsync: () => Promise<Record<string, string>>;
    };
    root.getCSSAsync = async function () {
      return { content: this.name };
    };

    const generated = await generate(root);

    expect(generated.tsx).toContain('content: Receiver card;');
    expect(generated.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'css-unavailable' }),
    ]));
  });

  it('reconstructs bound structural tokens with kebab-case names and fallbacks', async () => {
    const child = frame('f:token-child', 'Token child', [], {
      boundVariables: {
        height: { id: 'size-height' },
        width: { id: 'size-width' },
      },
      height: 80,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      width: 240,
    });
    const root = frame('f:structural-tokens', 'Structural tokens', [child], {
      boundVariables: {
        counterAxisSpacing: { id: 'spacing-counter-gap' },
        height: { id: 'size-root-height' },
        itemSpacing: { id: 'spacing-gap' },
        paddingBottom: { id: 'spacing-padding' },
        paddingLeft: { id: 'spacing-padding' },
        paddingRight: { id: 'spacing-padding' },
        paddingTop: { id: 'spacing-padding' },
      },
      height: 400,
      counterAxisSpacing: 12,
      itemSpacing: 16,
      layoutWrap: 'WRAP',
      layoutSizingVertical: 'FIXED',
      paddingBottom: 24,
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 24,
    });
    const variables: Record<string, { id: string; name: string }> = {
      'size-height': { id: 'size-height', name: 'Size/Card/Height' },
      'size-root-height': {
        id: 'size-root-height',
        name: 'Size/Content/Height',
      },
      'size-width': { id: 'size-width', name: 'Size/Card/Width' },
      'spacing-gap': { id: 'spacing-gap', name: 'Spacing/Layout Medium' },
      'spacing-counter-gap': {
        id: 'spacing-counter-gap',
        name: 'Spacing/Layout Small',
      },
      'spacing-padding': {
        id: 'spacing-padding',
        name: 'Spacing/Container/Large',
      },
    };
    const loadVariable = vi.fn((id: string) =>
      Promise.resolve(variables[id] ?? null));

    const generated = await generate(root, { loadVariable });

    expect(generated.tsx).toContain(
      'row-gap: var(--spacing-layout-medium, 16px);',
    );
    expect(generated.tsx).toContain(
      'column-gap: var(--spacing-layout-small, 12px);',
    );
    expect(generated.tsx).toContain(
      'padding: var(--spacing-container-large, 24px);',
    );
    expect(generated.tsx).toContain(
      'height: var(--size-content-height, 400px);',
    );
    expect(generated.tsx).toContain(
      'width: var(--size-card-width, 240px);',
    );
    expect(generated.tsx).toContain(
      'height: var(--size-card-height, 80px);',
    );
    expect(loadVariable).toHaveBeenCalledTimes(6);
  });

  it('does not add the colors import for literal colors or non-color tokens', async () => {
    const literal = frame('f:literal-colors', 'Literal colors', [], {
      css: {
        background: '#fff',
        color: 'var(--font-size-body, 1rem)',
      },
    });

    const generated = await generate(literal);

    expectValidTsx(generated.tsx);
    expect(generated.tsx).not.toContain("from 'styles/colors'");
    expect(generated.tsx).toContain('background: #fff;');
    expect(generated.tsx).toContain('color: var(--font-size-body, 1rem);');
  });
});
