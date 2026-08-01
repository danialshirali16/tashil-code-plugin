import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, type ConnectionMetadata } from '../types';
import { component, frame, instance, text } from '../layout/fixtures';
import { extractFigmaSemanticSnapshot } from '../semantic/figma-extractor';
import { createDialogNode, createDialogRecipe } from '../semantic/fixtures';
import { inspectFrame, type InspectableNode } from './inspect-frame';

/**
 * M4 Layout Composer / frame-inspection compatibility for semantic connections.
 *
 * A semantically connected Dialog that appears *inside* an inspected frame must
 * resolve through the semantic pipeline — not the legacy `propMappings` path —
 * producing the same production-shaped usage as selecting it directly. Nested
 * design values come from the live instance subtree used by semantic
 * resolution; the layout traversal itself still treats the instance as atomic.
 */

function semanticDialogMetadata(): ConnectionMetadata {
  const recipe = createDialogRecipe();
  // Populate the snapshot with captured samples so nested sources resolve
  // without traversing the instance's internals.
  recipe.figmaSnapshot = extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot;
  return {
    componentName: 'ConfirmationDialog',
    importPath: '@tashilcar/ui',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    semanticRecipe: recipe,
  } as ConnectionMetadata;
}

function dialogInstance(
  intent: 'Danger' | 'Default' = 'Danger',
  title = 'Delete account?',
): SceneNode {
  const main = component('c:dialog', 'Dialog', JSON.stringify(semanticDialogMetadata()));
  const buttonMain = {
    ...component('c:button', 'Button'),
    key: 'button-main-key',
  } as unknown as ReturnType<typeof component>;
  const node = instance('i:dialog', 'Dialog', main, {
    componentProperties: { intent: { type: 'VARIANT', value: intent } },
  });
  return {
    ...(node as unknown as Record<string, unknown>),
    children: [
      frame('f:header', 'Header', [
        text('t:title', 'Title', title),
        text('t:description', 'Description', 'This action cannot be undone.'),
      ]),
      frame('f:footer', 'Footer', [
        instance('i:secondary', 'Secondary action', buttonMain, {
          componentProperties: {
            label: { type: 'TEXT', value: 'Cancel' },
          },
        }),
        instance('i:primary', 'Primary action', buttonMain, {
          componentProperties: {
            label: { type: 'TEXT', value: 'Delete' },
          },
        }),
      ]),
    ],
  } as unknown as SceneNode;
}

/** Attach an empty `getCSSAsync` so the root produces no CSS diagnostic. */
function withCss(node: unknown): InspectableNode {
  return { ...(node as InspectableNode), getCSSAsync: () => Promise.resolve({}) };
}

describe('inspectFrame — semantic connections', () => {
  it('resolves a nested semantically connected Dialog to the approved usage', async () => {
    const root = withCss(frame('f:root', 'Confirmation surface', [dialogInstance()]));

    const inspection = await inspectFrame(root);

    expect(inspection.diagnostics).toEqual([]);
    expect(inspection.connectedComponents).toHaveLength(1);

    const entry = inspection.connectedComponents[0];
    expect(entry.componentName).toBe('ConfirmationDialog');
    expect(entry.layerPath).toEqual(['Confirmation surface', 'Dialog']);

    const generated = [
      entry.usage.imports.map((i) => `import { ${i.importedName} } from ${JSON.stringify(i.modulePath)};`).join('\n'),
      '',
      entry.usage.jsx,
    ].join('\n');

    expect(generated).toBe([
      'import { ConfirmationDialog } from "@tashilcar/ui";',
      '',
      '<ConfirmationDialog',
      '  intent={"danger"}',
      '  title={"Delete account?"}',
      '  description={"This action cannot be undone."}',
      '  cancelAction={{ label: "Cancel" }}',
      '  confirmAction={{ label: "Delete" }}',
      '  onConfirm={onConfirm /* Set in application. */}',
      '/>',
    ].join('\n'));
  });

  it('reflects live top-level and nested instance values', async () => {
    const defaultVariant = dialogInstance('Default', 'Live default title');
    const root = frame('f:root', 'Surface', [defaultVariant]) as unknown as InspectableNode;

    const inspection = await inspectFrame(root);

    expect(inspection.connectedComponents[0].usage.jsx).toContain('intent={"default"}');
    expect(inspection.connectedComponents[0].usage.jsx).toContain(
      'title={"Live default title"}',
    );
  });

  it('never emits fictional compound components for a nested Dialog', async () => {
    const root = frame('f:root', 'Surface', [dialogInstance()]) as unknown as InspectableNode;

    const inspection = await inspectFrame(root);
    const jsx = inspection.connectedComponents[0].usage.jsx;

    expect(jsx).not.toContain('Dialog.Header');
    expect(jsx).not.toContain('Dialog.Footer');
    expect(inspection.connectedComponents[0].usage.imports).toHaveLength(1);
  });
});
