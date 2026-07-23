import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { createUsageSnippet, type SelectionLike } from '../codegen';
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

  describe('pre-feature reality (frames and other nodes are not yet supported)', () => {
    // Phase 2 will replace each body. The assertions here document *why* each
    // case is a placeholder today and that the fixture itself is well-formed.

    it('verticalForm: fixture is a VERTICAL frame root', () => {
      const root = fixtures.verticalForm();
      expect(root.type).toBe('FRAME');
      expect(root.layoutMode).toBe('VERTICAL');
      expect(root.children.length).toBe(2);
      expectValidTypeScript('<div />'); // placeholder body until the emitter exists
    });

    it('horizontalHeader: fixture is a HORIZONTAL frame root', () => {
      const root = fixtures.horizontalHeader();
      expect(root.type).toBe('FRAME');
      expect(root.layoutMode).toBe('HORIZONTAL');
      expect(root.children.length).toBe(2);
    });

    it('nestedAutoLayout: fixture nests a frame inside a frame', () => {
      const root = fixtures.nestedAutoLayout();
      const inner = root.children[0];
      expect(inner.type).toBe('FRAME');
      expect((inner as { layoutMode: string }).layoutMode).toBe('VERTICAL');
    });

    it('wrappingActionRow: fixture enables layoutWrap', () => {
      const root = fixtures.wrappingActionRow();
      expect(root.layoutWrap).toBe('WRAP');
      expect(root.counterAxisSpacing).toBe(8);
    });

    it('connectedMultiplePackages: two distinct import paths', () => {
      const root = fixtures.connectedMultiplePackages();
      expect(root.children.length).toBe(2);
    });

    it('unconnectedInstance: main component carries no connection data', () => {
      const root = unconnectedInstance();
      const child = root.children[0] as unknown as {
        getMainComponentAsync: () => Promise<{
          getSharedPluginData: (namespace: string, key: string) => string;
        }>;
      };
      return Promise.resolve(child.getMainComponentAsync()).then((component) => {
        expect(component.getSharedPluginData('ns', 'key')).toBe('');
      });
    });

    it('brokenInstance: getMainComponentAsync resolves null', () => {
      const root = brokenInstance();
      const child = root.children[0] as unknown as {
        getMainComponentAsync: () => Promise<unknown>;
      };
      return Promise.resolve(child.getMainComponentAsync()).then((main) => {
        expect(main).toBeNull();
      });
    });

    it('rawText: fixture is a TEXT node with characters', () => {
      const node = rawText();
      expect(node.type).toBe('TEXT');
      expect((node as unknown as { characters: string }).characters).toBe('Add a payment method');
    });

    it('absolutePositionedChild: child is absolutely positioned', () => {
      const root = absolutePositionedChild();
      const child = root.children[0] as unknown as { layoutPositioning: string };
      expect(child.layoutPositioning).toBe('ABSOLUTE');
    });

    it('unsupportedVector: fixture is a VECTOR node', () => {
      const node = unsupportedVector();
      expect(node.type).toBe('VECTOR');
    });
  });
});
