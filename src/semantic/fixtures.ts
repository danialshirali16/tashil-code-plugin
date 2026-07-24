/**
 * Deterministic Dialog fixtures for the semantic-connect test suite.
 *
 * They model the roadmap's canonical structural mismatch: a Figma Dialog
 * whose Header/Footer layer tree looks nothing like the flat public API of
 * the source `ConfirmationDialog` component.
 */

import type { SemanticNodeLike } from './figma-extractor';
import {
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  type SemanticConnectionRecipe,
} from './types';

export const DIALOG_SOURCE_FIXTURE = `
export interface ConfirmationDialogProps {
  intent: 'danger' | 'default';
  title: string;
  description?: string;
  cancelAction: { label: string };
  confirmAction: { label: string };
  onConfirm: () => void;
}
`;

export function createDialogNode(): SemanticNodeLike {
  return {
    children: [
      {
        children: [
          { characters: 'Delete account?', name: 'Title', type: 'TEXT' },
          { characters: 'This action cannot be undone.', name: 'Description', type: 'TEXT' },
        ],
        name: 'Header',
        type: 'FRAME',
      },
      {
        children: [
          {
            componentProperties: { label: 'Cancel' },
            mainComponentKey: 'button-main-key',
            name: 'Secondary action',
            type: 'INSTANCE',
          },
          {
            componentProperties: { label: 'Delete' },
            mainComponentKey: 'button-main-key',
            name: 'Primary action',
            type: 'INSTANCE',
          },
        ],
        name: 'Footer',
        type: 'FRAME',
      },
    ],
    name: 'Dialog',
    type: 'COMPONENT',
  };
}

export function createDialogRecipe(): SemanticConnectionRecipe {
  return {
    bindings: [
      {
        id: 'binding-intent',
        requirement: 'required',
        source: {
          kind: 'component-property',
          propertyId: 'prop-intent',
          propertyName: 'intent',
        },
        target: { path: ['intent'], typeName: "'danger' | 'default'" },
        transform: { kind: 'enum', map: { Danger: 'danger', Default: 'default' } },
      },
      {
        id: 'binding-title',
        requirement: 'required',
        source: {
          kind: 'nested-text',
          locator: { fragile: true, namePath: ['Header', 'Title'] },
        },
        target: { path: ['title'], typeName: 'string' },
      },
      {
        id: 'binding-description',
        requirement: 'optional',
        source: {
          kind: 'nested-text',
          locator: { fragile: true, namePath: ['Header', 'Description'] },
        },
        target: { path: ['description'], typeName: 'string' },
      },
      {
        id: 'binding-cancel-label',
        requirement: 'required',
        source: {
          kind: 'nested-property',
          locator: {
            componentKey: 'button-main-key',
            fragile: false,
            namePath: ['Footer', 'Secondary action'],
          },
          propertyName: 'label',
        },
        target: { path: ['cancelAction', 'label'], typeName: 'string' },
      },
      {
        id: 'binding-confirm-label',
        requirement: 'required',
        source: {
          kind: 'nested-property',
          locator: {
            componentKey: 'button-main-key',
            fragile: false,
            namePath: ['Footer', 'Primary action'],
          },
          propertyName: 'label',
        },
        target: { path: ['confirmAction', 'label'], typeName: 'string' },
      },
      {
        id: 'binding-on-confirm',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['onConfirm'], typeName: '() => void' },
      },
    ],
    figmaSnapshot: {
      componentId: '1:23',
      componentName: 'Dialog',
      nestedSources: [],
    },
    revision: 1,
    schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
  };
}
