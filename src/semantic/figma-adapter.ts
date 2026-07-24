/**
 * Adapter from live Figma scene nodes to the structural {@link SemanticNodeLike}
 * shape consumed by the semantic extractor and resolver.
 *
 * This is the only semantic module that touches Figma plugin types; everything
 * downstream stays pure and unit-testable. Traversal is bounded by the shared
 * semantic limits and is used for connect authoring and usage resolution only —
 * Layout Composer never sees these trees.
 */

import { CONNECTION_KEY, CONNECTION_NAMESPACE } from '../types';
import { SEMANTIC_LIMITS } from './types';
import type { SemanticNodeLike } from './figma-extractor';

/**
 * Materialize a bounded semantic view of `root`'s subtree. Children beyond the
 * node budget or depth limit are simply absent; the resolver then reports the
 * affected locators as unresolved instead of failing the whole generation.
 */
export async function createSemanticNodeTree(root: SceneNode): Promise<SemanticNodeLike> {
  const budget = { remaining: SEMANTIC_LIMITS.maxExtractionNodes };
  return convertNode(root, 0, budget);
}

async function convertNode(
  node: SceneNode,
  depth: number,
  budget: { remaining: number },
): Promise<SemanticNodeLike> {
  budget.remaining -= 1;

  const converted: SemanticNodeLike & {
    children?: SemanticNodeLike[];
  } = {
    name: node.name,
    type: node.type,
    ...(node.visible === false ? { visible: false } : {}),
  };

  if (node.type === 'TEXT') {
    return { ...converted, characters: node.characters };
  }

  if (node.type === 'INSTANCE') {
    const mainComponent = await getMainComponent(node);
    if (mainComponent) {
      const componentKey = readComponentKey(mainComponent);
      if (componentKey !== undefined) {
        converted.mainComponentKey = componentKey;
      }
      if (hasOwnConnection(mainComponent)) {
        converted.hasOwnConnection = true;
      }
    }
    converted.componentProperties = readInstanceProperties(node);
  }

  if (depth >= SEMANTIC_LIMITS.maxLocatorDepth || budget.remaining <= 0) {
    return converted;
  }

  if ('children' in node) {
    const children: SemanticNodeLike[] = [];
    for (const child of node.children) {
      if (budget.remaining <= 0) {
        break;
      }
      children.push(await convertNode(child, depth + 1, budget));
    }
    if (children.length > 0) {
      converted.children = children;
    }
  }

  return converted;
}

async function getMainComponent(node: InstanceNode): Promise<ComponentNode | null> {
  try {
    return await node.getMainComponentAsync();
  } catch (_error) {
    return null;
  }
}

/** Prefer the published component key; fall back to the local node id. */
function readComponentKey(mainComponent: ComponentNode): string | undefined {
  if (typeof mainComponent.key === 'string' && mainComponent.key.length > 0) {
    return mainComponent.key;
  }
  return mainComponent.id || undefined;
}

function hasOwnConnection(mainComponent: ComponentNode): boolean {
  try {
    const owner = mainComponent.parent?.type === 'COMPONENT_SET'
      ? mainComponent.parent
      : mainComponent;
    return owner.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY) !== '';
  } catch (_error) {
    return false;
  }
}

function readInstanceProperties(node: InstanceNode): Record<string, string | boolean> {
  const properties = Object.create(null) as Record<string, string | boolean>;

  try {
    for (const [rawName, property] of Object.entries(node.componentProperties)) {
      if (typeof property.value === 'string' || typeof property.value === 'boolean') {
        properties[normalizePropertyName(rawName)] = property.value;
      }
    }
  } catch (_error) {
    // Detached or inaccessible instances expose no properties.
  }

  return properties;
}

/** Strip the `#id` suffix Figma appends to non-variant property names. */
function normalizePropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}
