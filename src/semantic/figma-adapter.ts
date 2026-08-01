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
import { validateSemanticRecipe } from './schema';
import { SEMANTIC_LIMITS } from './types';
import type { SemanticConnectionRecipe } from './types';
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
      const connection = readOwnConnection(mainComponent);
      if (connection) {
        converted.hasOwnConnection = true;
        converted.connectedComponentName = connection.componentName;
        converted.connectedImportPath = connection.importPath;
        if (connection.semanticRecipe !== undefined) {
          converted.connectedRecipe = connection.semanticRecipe;
        }
      }
    }
    converted.componentProperties = readInstanceProperties(node);
    const instanceSwaps = await readInstanceSwaps(node);
    if (Object.keys(instanceSwaps).length > 0) {
      converted.instanceSwaps = instanceSwaps;
    }
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

/**
 * Read a nested instance's own connection identity. Only the public component
 * name and import path are taken — enough to render it as a component value
 * without the parent inventing a name. Returns undefined when the child is
 * unconnected or its data is unreadable.
 */
function readOwnConnection(
  mainComponent: ComponentNode,
): {
  componentName: string;
  importPath: string;
  semanticRecipe?: SemanticConnectionRecipe;
} | undefined {
  let raw: string;
  try {
    const owner = mainComponent.parent?.type === 'COMPONENT_SET'
      ? mainComponent.parent
      : mainComponent;
    raw = owner.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);
  } catch (_error) {
    return undefined;
  }

  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object'
      && parsed !== null
      && typeof (parsed as { componentName?: unknown }).componentName === 'string'
      && typeof (parsed as { importPath?: unknown }).importPath === 'string'
    ) {
      const { componentName, importPath } = parsed as {
        componentName: string;
        importPath: string;
      };
      const recipeValidation = validateSemanticRecipe(
        (parsed as { semanticRecipe?: unknown }).semanticRecipe,
      );
      return {
        componentName,
        importPath,
        ...(recipeValidation.ok ? { semanticRecipe: recipeValidation.recipe } : {}),
      };
    }
  } catch (_error) {
    // A malformed child connection simply yields no component identity.
  }

  return undefined;
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

async function readInstanceSwaps(
  node: InstanceNode,
): Promise<Record<string, { componentId: string; componentName: string; importPath?: string }>> {
  const swaps = Object.create(null) as Record<
    string,
    { componentId: string; componentName: string; importPath?: string }
  >;

  try {
    for (const [rawName, property] of Object.entries(node.componentProperties)) {
      if (property.type !== 'INSTANCE_SWAP' || typeof property.value !== 'string') {
        continue;
      }
      let component: BaseNode | null;
      try {
        component = await figma.getNodeByIdAsync(property.value);
      } catch (_error) {
        continue;
      }
      if (component?.type === 'COMPONENT') {
        const connection = readOwnConnection(component);
        swaps[normalizePropertyName(rawName)] = {
          componentId: component.id,
          componentName: component.name,
          ...(connection ? { importPath: connection.importPath } : {}),
        };
      }
    }
  } catch (_error) {
    // Detached or inaccessible instances expose no resolved swap identities.
  }

  return swaps;
}

/** Strip the `#id` suffix Figma appends to non-variant property names. */
function normalizePropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}
