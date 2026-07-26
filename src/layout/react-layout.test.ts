import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import { createUsageSnippet } from '../codegen';
import {
  extractLayout,
  type ExtractLayoutOptions,
} from './figma-layout-extractor';
import {
  absolutePositionedChild,
  component,
  connection,
  duplicateNamesAcrossPackages,
  frame,
  instance,
  nestedAutoLayout,
  rawText,
  text,
  unconnectedInstance,
  unsupportedVector,
  verticalForm,
} from './fixtures';
import { generateLayout } from './generate-layout';

function generate(
  node: Parameters<typeof extractLayout>[0],
  options: ExtractLayoutOptions = {},
) {
  return extractLayout(node, options).then((document) =>
    generateLayout(document));
}

function expectValidTsx(source: string): void {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'generated-layout.tsx',
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

  expect(errors).toEqual([]);
}

describe('full React layout generation', () => {
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
      const button = component(
        'c:button-with-icon',
        'Button',
        JSON.stringify(connection({
          childrenMode: 'none',
          componentName: 'Button',
          propMappings: {
            leadingIcon: {
              '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
            },
          },
        })),
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
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('keeps non-auto-layout children and reports manual positioning', async () => {
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
    expect(generated.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unsupported-layout-mode' }),
      expect.objectContaining({ reason: 'absolute-positioning' }),
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
    expect(generated.diagnostics).toEqual([
      expect.objectContaining({ reason: 'absolute-positioning' }),
    ]);
  });

  it('preserves an unsupported asset as a comment and diagnostic', async () => {
    const generated = await generate(frame('f:asset', 'Asset card', [
      unsupportedVector(),
    ]));

    expect(generated.tsx).toContain('{/* VECTOR: Divider */}');
    expect(generated.diagnostics).toEqual([
      expect.objectContaining({
        nodeId: 'v:divider',
        reason: 'unsupported-node',
      }),
    ]);
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
