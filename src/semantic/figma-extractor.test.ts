import { describe, expect, it } from 'vitest';
import { createDialogNode } from './fixtures';
import {
  extractFigmaSemanticSnapshot,
  resolveLocator,
  type SemanticNodeLike,
} from './figma-extractor';
import { SEMANTIC_LIMITS } from './types';

describe('extractFigmaSemanticSnapshot', () => {
  it('captures nested text and nested instance properties with display paths', () => {
    const { snapshot, partial, diagnostics } = extractFigmaSemanticSnapshot(
      createDialogNode(),
      '1:23',
    );

    expect(partial).toBe(false);
    expect(diagnostics).toEqual([]);
    expect(snapshot.componentId).toBe('1:23');
    expect(snapshot.nestedSources.map((source) => source.displayPath)).toEqual([
      'Header / Title',
      'Header / Description',
      'Footer / Secondary action / label',
      'Footer / Primary action / label',
    ]);
  });

  it('marks name-only locators fragile and instance-anchored locators stable', () => {
    const { snapshot } = extractFigmaSemanticSnapshot(createDialogNode(), '1:23');
    const bySource = new Map(
      snapshot.nestedSources.map((source) => [source.displayPath, source]),
    );

    expect(bySource.get('Header / Title')?.locator.fragile).toBe(true);
    expect(bySource.get('Footer / Primary action / label')?.locator).toEqual({
      componentKey: 'button-main-key',
      fragile: false,
      namePath: ['Footer', 'Primary action'],
    });
  });

  it('captures sample values for review', () => {
    const { snapshot } = extractFigmaSemanticSnapshot(createDialogNode(), '1:23');
    const bySource = new Map(
      snapshot.nestedSources.map((source) => [source.displayPath, source]),
    );

    expect(bySource.get('Header / Title')?.sampleValue).toBe('Delete account?');
    expect(bySource.get('Footer / Primary action / label')?.sampleValue).toBe('Delete');
  });

  it('skips hidden layers', () => {
    const root = createDialogNode();
    const header = root.children![0] as { visible?: boolean };
    header.visible = false;

    const { snapshot } = extractFigmaSemanticSnapshot(root, '1:23');

    expect(snapshot.nestedSources.map((source) => source.displayPath)).toEqual([
      'Footer / Secondary action / label',
      'Footer / Primary action / label',
    ]);
  });

  it('does not traverse into nested instances with their own connection', () => {
    const root = createDialogNode();
    const footer = root.children![1];
    (footer.children![0] as { hasOwnConnection?: boolean }).hasOwnConnection = true;
    (footer.children![0] as { children?: SemanticNodeLike[] }).children = [
      { characters: 'Internal', name: 'Label', type: 'TEXT' },
    ];

    const { snapshot } = extractFigmaSemanticSnapshot(root, '1:23');

    expect(
      snapshot.nestedSources.some((source) => source.displayPath.includes('Label')),
    ).toBe(false);
    // The connected instance's own properties are still usable as sources.
    expect(
      snapshot.nestedSources.some(
        (source) => source.displayPath === 'Footer / Secondary action / label',
      ),
    ).toBe(true);
  });

  it('returns partial results with diagnostics when limits are hit', () => {
    const children: SemanticNodeLike[] = [];
    for (let index = 0; index < SEMANTIC_LIMITS.maxNestedSources + 10; index += 1) {
      children.push({ characters: `Value ${index}`, name: `Text ${index}`, type: 'TEXT' });
    }

    const { snapshot, partial, diagnostics } = extractFigmaSemanticSnapshot(
      { children, name: 'Huge', type: 'COMPONENT' },
      '9:9',
    );

    expect(partial).toBe(true);
    expect(snapshot.nestedSources).toHaveLength(SEMANTIC_LIMITS.maxNestedSources);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe('resolveLocator', () => {
  it('resolves a nested text layer by name path', () => {
    const node = resolveLocator(createDialogNode(), {
      fragile: true,
      namePath: ['Header', 'Title'],
    });

    expect(node?.characters).toBe('Delete account?');
  });

  it('fails when the locator requires a component key the path no longer has', () => {
    const node = resolveLocator(createDialogNode(), {
      componentKey: 'some-other-key',
      fragile: false,
      namePath: ['Footer', 'Primary action'],
    });

    expect(node).toBeUndefined();
  });

  it('fails on ambiguous sibling names instead of guessing', () => {
    const root = createDialogNode();
    root.children = [
      ...root.children!,
      { children: [], name: 'Header', type: 'FRAME' },
    ];

    const node = resolveLocator(root, { fragile: true, namePath: ['Header', 'Title'] });

    expect(node).toBeUndefined();
  });
});
