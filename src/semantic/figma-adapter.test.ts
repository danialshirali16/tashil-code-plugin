/// <reference types="@figma/plugin-typings" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSemanticNodeTree } from './figma-adapter';

describe('semantic Figma adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves instance-swap ids to the selected component identity', async () => {
    vi.stubGlobal('figma', {
      getNodeByIdAsync: vi.fn(async (id: string) => ({
        id,
        name: 'Trash',
        type: 'COMPONENT',
      })),
    });
    const instance = {
      children: [],
      componentProperties: {
        'leadingIcon#property-id': {
          type: 'INSTANCE_SWAP',
          value: 'trash-component-id',
        },
      },
      getMainComponentAsync: async () => null,
      name: 'Button',
      type: 'INSTANCE',
      visible: true,
    } as unknown as SceneNode;

    const semanticNode = await createSemanticNodeTree(instance);

    expect(semanticNode.instanceSwaps).toEqual({
      leadingIcon: {
        componentId: 'trash-component-id',
        componentName: 'Trash',
      },
    });
    expect(figma.getNodeByIdAsync).toHaveBeenCalledWith('trash-component-id');
  });
});
