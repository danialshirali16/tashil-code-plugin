import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { createUsageSnippet, type SelectionLike } from '../codegen';
import { extractLayout } from './figma-layout-extractor';
import {
  absolutePositionedChild,
  brokenInstance,
  fixtures,
  rawText,
  unconnectedInstance,
  unsupportedVector,
} from './fixtures';

/**
 * Phase 0 golden expectations.
 *
 * Today the layout pipeline does not exist: `resolveSelection` in `main.ts`
 * only handles INSTANCE / COMPONENT / COMPONENT_SET, so any frame, group, text,
 * or vector selection is "invalid". These tests pin that pre-feature reality
 * and the exact connected-component TSX that Phase 1 must preserve.
 *
 * Each unsupported-case test is written so Phase 1 / 3 changes the *expected
 * body*, not the fixture — the fixture stays the stable input.
 */

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

describe('layout fixtures — Phase 0 baseline', () => {
  describe('connected-component compatibility lock (frozen)', () => {
    // These literal strings are the byte-stable contract Phase 1's
    // `createComponentUsage` wrapper must reproduce. Captured from the current
    // `createUsageSnippet` in Phase 0.

    const sel = (overrides: Partial<SelectionLike> = {}): SelectionLike => ({
      componentProperties: {},
      displayText: 'Continue',
      ...overrides,
    });

    it('connectedOnePackage: button with a mapped variant prop', () => {
      // The exact TSX a connected Button instance produces today.
      const code = createUsageSnippet(
        {
          schemaVersion: 4 as never,
          componentName: 'Button',
          importPath: '@tashilcar/ui',
          propMappings: { intent: { primary: { prop: 'variant', value: 'primary' } } },
        } as never,
        sel({ componentProperties: { intent: 'primary', label: 'Continue' } }),
      ).code;
      expectValidTypeScript(code);
      expect(code).toBe([
        'import { Button } from "@tashilcar/ui";',
        '',
        '<Button variant={"primary"}>',
        '  Continue',
        '</Button>',
      ].join('\n'));
    });

    it('duplicateNamesAcrossPackages: a single Card usage (pre-aliasing baseline)', () => {
      // Before Phase 1's import dedup, a single usage emits the un-aliased name.
      const code = createUsageSnippet(
        {
          schemaVersion: 4 as never,
          componentName: 'Card',
          importPath: '@tashilcar/ui',
        } as never,
        sel({ componentProperties: { label: 'Primary card' }, displayText: 'Primary card' }),
      ).code;
      expectValidTypeScript(code);
      expect(code).toBe([
        'import { Card } from "@tashilcar/ui";',
        '',
        '<Card>',
        '  Primary card',
        '</Card>',
      ].join('\n'));
    });
  });

  describe('fixture → IR extraction (Phase 2)', () => {
    // Phase 2 added the extractor. These bridge the Phase 0 fixtures to real
    // extraction behavior, asserting the IR shape each fixture produces.

    it('verticalForm extracts to a vertical container with two components', async () => {
      const doc = await extractLayout(fixtures.verticalForm());
      expect(doc.root.kind).toBe('container');
      if (doc.root.kind !== 'container') return;
      expect(doc.root.layout.axis).toBe('vertical');
      expect(doc.root.children.every((c) => c.kind === 'component')).toBe(true);
    });

    it('horizontalHeader extracts to a horizontal container', async () => {
      const doc = await extractLayout(fixtures.horizontalHeader());
      expect(doc.root.kind).toBe('container');
      if (doc.root.kind !== 'container') return;
      expect(doc.root.layout.axis).toBe('horizontal');
    });

    it('nestedAutoLayout extracts a nested container structure', async () => {
      const doc = await extractLayout(fixtures.nestedAutoLayout());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      expect(doc.root.children[0].kind).toBe('container');
    });

    it('wrappingActionRow extracts with wrap + counter gap', async () => {
      const doc = await extractLayout(fixtures.wrappingActionRow());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      expect(doc.root.layout.wrap).toBe(true);
      expect(doc.root.layout.counterGap).toBe(8);
    });

    it('connectedMultiplePackages extracts two component usages', async () => {
      const doc = await extractLayout(fixtures.connectedMultiplePackages());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      const components = doc.root.children.filter((c) => c.kind === 'component');
      expect(components.length).toBe(2);
    });

    it('unconnectedInstance extracts to a placeholder with a diagnostic', async () => {
      const doc = await extractLayout(unconnectedInstance());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      expect(doc.root.children[0].kind).toBe('placeholder');
      expect(doc.diagnostics.some((d) => d.reason === 'unconnected-instance')).toBe(true);
    });

    it('brokenInstance extracts to a placeholder with a missing-main-component diagnostic', async () => {
      const doc = await extractLayout(brokenInstance());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      expect(doc.root.children[0].kind).toBe('placeholder');
      expect(doc.diagnostics.some((d) => d.reason === 'missing-main-component')).toBe(true);
    });

    it('rawText extracts to a text IR node', async () => {
      const doc = await extractLayout(rawText());
      expect(doc.root.kind).toBe('text');
      if (doc.root.kind !== 'text') return;
      expect(doc.root.text).toBe('Add a payment method');
    });

    it('absolutePositionedChild extracts the child as an absolute-positioning placeholder', async () => {
      const doc = await extractLayout(absolutePositionedChild());
      if (doc.root.kind !== 'container') throw new Error('expected container');
      expect(doc.root.children[0].kind).toBe('placeholder');
      expect(doc.diagnostics.some((d) => d.reason === 'absolute-positioning')).toBe(true);
    });

    it('unsupportedVector extracts to an unsupported-root placeholder', async () => {
      const doc = await extractLayout(unsupportedVector());
      expect(doc.root.kind).toBe('placeholder');
      expect(doc.diagnostics.some((d) => d.reason === 'unsupported-root')).toBe(true);
    });
  });
});
