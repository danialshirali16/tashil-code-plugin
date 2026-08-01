import { describe, expect, it } from 'vitest';
import type { FigmaComponentSnapshot } from '../types';
import {
  createRecipeDraft,
  OPTION_RUNTIME,
  setTargetOption,
  validateRecipeDraft,
} from './authoring';
import { getComplexComponentRecipe } from './complex-recipes';
import { resolveSemanticUsage } from './resolver';
import type {
  SourceContract,
  SourceTargetDescriptor,
  SourceTargetKind,
} from './source-contract';
import type { FigmaSemanticSnapshot } from './types';

type OverlayCase = {
  componentName: string;
  frameworkTarget: { kind: SourceTargetKind; name: string; typeName: string };
  runtimeTargets: Array<{ kind: SourceTargetKind; name: string; required?: boolean }>;
  visualTarget: string;
};

const OVERLAY_CASES: OverlayCase[] = [
  {
    componentName: 'Drawer',
    frameworkTarget: { kind: 'environment', name: 'PaperProps', typeName: 'Partial<PaperProps>' },
    runtimeTargets: [
      { kind: 'controlled', name: 'open', required: true },
      { kind: 'event', name: 'onClose', required: true },
      { kind: 'node', name: 'children' },
      { kind: 'array', name: 'actionButtons' },
    ],
    visualTarget: 'hideBackdrop',
  },
  {
    componentName: 'TashilDesktopModal',
    frameworkTarget: { kind: 'environment', name: 'TransitionProps', typeName: 'TransitionProps' },
    runtimeTargets: [
      { kind: 'controlled', name: 'open', required: true },
      { kind: 'event', name: 'onClose' },
      { kind: 'node', name: 'children' },
    ],
    visualTarget: 'fullScreen',
  },
  {
    componentName: 'TashilInfoModal',
    frameworkTarget: { kind: 'record', name: 'submitProps', typeName: 'ButtonProps' },
    runtimeTargets: [
      { kind: 'controlled', name: 'open' },
      { kind: 'event', name: 'onCancel' },
      { kind: 'event', name: 'onSubmit' },
      { kind: 'array', name: 'actionButtons' },
    ],
    visualTarget: 'loading',
  },
  {
    componentName: 'TashilMobileDrawer',
    frameworkTarget: { kind: 'environment', name: 'SlideProps', typeName: 'SlideProps' },
    runtimeTargets: [
      { kind: 'controlled', name: 'open', required: true },
      { kind: 'event', name: 'onClose' },
      { kind: 'node', name: 'children' },
    ],
    visualTarget: 'hideBackdrop',
  },
  {
    componentName: 'TashilPopover',
    frameworkTarget: { kind: 'record', name: 'anchorOrigin', typeName: 'PopoverOrigin' },
    runtimeTargets: [
      { kind: 'controlled', name: 'open', required: true },
      { kind: 'event', name: 'onClose' },
      { kind: 'environment', name: 'anchorEl' },
      { kind: 'node', name: 'children' },
    ],
    visualTarget: 'disablePortal',
  },
  {
    componentName: 'TashilTooltip',
    frameworkTarget: { kind: 'environment', name: 'PopperProps', typeName: 'Partial<PopperProps>' },
    runtimeTargets: [
      { kind: 'node', name: 'title', required: true },
      { kind: 'node', name: 'children', required: true },
    ],
    visualTarget: 'arrow',
  },
];

type DateRangeCase = {
  componentName: string;
  omittedTargets: string[];
  runtimeTargets: Array<{ kind: SourceTargetKind; name: string; required?: boolean }>;
};

const DATE_RANGE_CASES: DateRangeCase[] = [
  {
    componentName: 'TashilDatePicker',
    omittedTargets: ['initialDate.day', 'initialDate.month', 'initialDate.year'],
    runtimeTargets: [
      { kind: 'event', name: 'onChange', required: true },
      { kind: 'event', name: 'onSubmit', required: true },
    ],
  },
  {
    componentName: 'TashilJalaliDatePicker',
    omittedTargets: ['initialDate', 'initialFrom', 'initialTo'],
    runtimeTargets: [
      { kind: 'event', name: 'onChangeDatePicker' },
      { kind: 'event', name: 'onChangeRangePicker' },
      { kind: 'event', name: 'onSubmit' },
      { kind: 'event', name: 'onCancel' },
    ],
  },
  {
    componentName: 'TashilSlider',
    omittedTargets: ['defaultValue', 'marks'],
    runtimeTargets: [
      { kind: 'controlled', name: 'value' },
      { kind: 'event', name: 'onChange' },
    ],
  },
  {
    componentName: 'Slider',
    omittedTargets: ['defaultValue', 'marks'],
    runtimeTargets: [
      { kind: 'controlled', name: 'value' },
      { kind: 'event', name: 'onChange' },
    ],
  },
];

function target(
  name: string,
  kind: SourceTargetKind,
  typeName = kind === 'visual' ? 'boolean' : 'unknown',
  required = false,
): SourceTargetDescriptor {
  return {
    kind,
    ownerProp: name,
    path: [name],
    required,
    typeName,
    ...(kind === 'visual' ? { values: [false, true] } : {}),
  };
}

function createOverlayInputs(testCase: OverlayCase): {
  contract: SourceContract;
  figmaSnapshot: FigmaComponentSnapshot;
  semanticSnapshot: FigmaSemanticSnapshot;
} {
  return {
    contract: {
      componentName: testCase.componentName,
      contentHash: `${testCase.componentName}-contract`,
      fileName: `${testCase.componentName}.tsx`,
      propsTypeName: `${testCase.componentName}Props`,
      targets: [
        ...testCase.runtimeTargets.map((runtimeTarget) => target(
          runtimeTarget.name,
          runtimeTarget.kind,
          'unknown',
          runtimeTarget.required,
        )),
        target(testCase.visualTarget, 'visual'),
        target(
          testCase.frameworkTarget.name,
          testCase.frameworkTarget.kind,
          testCase.frameworkTarget.typeName,
        ),
      ],
    },
    figmaSnapshot: {
      componentId: testCase.componentName,
      componentName: testCase.componentName,
      properties: [{
        defaultValue: true,
        id: testCase.visualTarget,
        name: testCase.visualTarget,
        options: [],
        rawKey: testCase.visualTarget,
        type: 'BOOLEAN',
      }],
    },
    semanticSnapshot: {
      componentId: testCase.componentName,
      componentName: testCase.componentName,
      nestedSources: [],
    },
  };
}

function createDateRangeInputs(testCase: DateRangeCase): {
  contract: SourceContract;
  figmaSnapshot: FigmaComponentSnapshot;
  semanticSnapshot: FigmaSemanticSnapshot;
} {
  const omittedTargets = testCase.omittedTargets.map((path) => {
    const segments = path.split('.');
    return {
      kind: path === 'marks' ? 'array' as const : 'visual' as const,
      ownerProp: segments[0],
      path: segments,
      required: false,
      typeName: path === 'marks' ? 'boolean | Mark[]' : 'number | number[]',
    };
  });
  return {
    contract: {
      componentName: testCase.componentName,
      contentHash: `${testCase.componentName}-contract`,
      fileName: `${testCase.componentName}.tsx`,
      propsTypeName: `${testCase.componentName}Props`,
      targets: [
        ...testCase.runtimeTargets.map((runtimeTarget) => target(
          runtimeTarget.name,
          runtimeTarget.kind,
          runtimeTarget.name === 'value' ? 'number | number[]' : 'unknown',
          runtimeTarget.required,
        )),
        ...omittedTargets,
        target('disabled', 'visual'),
      ],
    },
    figmaSnapshot: {
      componentId: testCase.componentName,
      componentName: testCase.componentName,
      properties: [{
        defaultValue: true,
        id: 'disabled',
        name: 'disabled',
        options: [],
        rawKey: 'disabled',
        type: 'BOOLEAN',
      }],
    },
    semanticSnapshot: {
      componentId: testCase.componentName,
      componentName: testCase.componentName,
      nestedSources: [],
    },
  };
}

describe('complex overlay recipes', () => {
  it.each(OVERLAY_CASES)(
    'uses application state and safe framework defaults for $componentName',
    (testCase) => {
      const { contract, figmaSnapshot, semanticSnapshot } = createOverlayInputs(testCase);
      const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
      const byTarget = new Map(recipe.bindings.map((binding) => [
        binding.target.path.join('.'),
        binding.source.kind,
      ]));

      for (const runtimeTarget of testCase.runtimeTargets) {
        expect(byTarget.get(runtimeTarget.name)).toBe('runtime');
      }
      expect(byTarget.get(testCase.visualTarget)).toBe('component-property');
      expect(byTarget.get(testCase.frameworkTarget.name)).toBe('omitted');
      expect(getComplexComponentRecipe(testCase.componentName)?.family).toBe('overlay');
      expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });
    },
  );

  it('generates production-shaped Popover runtime placeholders', () => {
    const testCase = OVERLAY_CASES.find(
      ({ componentName }) => componentName === 'TashilPopover',
    );
    if (!testCase) {
      throw new Error('Missing TashilPopover overlay fixture.');
    }
    const { contract, figmaSnapshot, semanticSnapshot } = createOverlayInputs(testCase);
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const result = resolveSemanticUsage(
      'TashilPopover',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { disablePortal: true } },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('open={open /* Set in application. */}');
    expect(result.usage.jsx).toContain('onClose={onClose /* Set in application. */}');
    expect(result.usage.jsx).toContain('anchorEl={anchorEl /* Set in application. */}');
    expect(result.usage.jsx).toContain('{children /* Set in application. */}');
    expect(result.usage.jsx).toContain('disablePortal');
    expect(result.usage.jsx).not.toContain('anchorOrigin=');
  });
});

describe('complex date and range recipes', () => {
  it.each(DATE_RANGE_CASES)(
    'keeps runtime values type-safe for $componentName',
    (testCase) => {
      const { contract, figmaSnapshot, semanticSnapshot } = createDateRangeInputs(testCase);
      const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
      const byTarget = new Map(recipe.bindings.map((binding) => [
        binding.target.path.join('.'),
        binding.source.kind,
      ]));

      for (const runtimeTarget of testCase.runtimeTargets) {
        expect(byTarget.get(runtimeTarget.name)).toBe('runtime');
      }
      for (const omittedTarget of testCase.omittedTargets) {
        expect(byTarget.get(omittedTarget)).toBe('omitted');
      }
      expect(byTarget.get('disabled')).toBe('component-property');
      expect(getComplexComponentRecipe(testCase.componentName)?.family).toBe('date-range');
      expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });
    },
  );

  it('generates a controlled array-capable slider without a conflicting default', () => {
    const testCase = DATE_RANGE_CASES.find(
      ({ componentName }) => componentName === 'TashilSlider',
    );
    if (!testCase) {
      throw new Error('Missing TashilSlider date-range fixture.');
    }
    const { contract, figmaSnapshot, semanticSnapshot } = createDateRangeInputs(testCase);
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const result = resolveSemanticUsage(
      'TashilSlider',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { disabled: true } },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('value={value /* Set in application. */}');
    expect(result.usage.jsx).toContain('onChange={onChange /* Set in application. */}');
    expect(result.usage.jsx).toContain('disabled');
    expect(result.usage.jsx).not.toContain('defaultValue=');
    expect(result.usage.jsx).not.toContain('marks=');
  });

  it('switches a Slider from controlled value to defaultValue without emitting both', () => {
    const testCase = DATE_RANGE_CASES.find(
      ({ componentName }) => componentName === 'Slider',
    );
    if (!testCase) {
      throw new Error('Missing Slider date-range fixture.');
    }
    const { contract, figmaSnapshot, semanticSnapshot } = createDateRangeInputs(testCase);
    const initial = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const updated = setTargetOption(
      initial,
      figmaSnapshot,
      ['defaultValue'],
      OPTION_RUNTIME,
    );
    const byTarget = new Map(updated.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ]));

    expect(byTarget.get('defaultValue')).toBe('runtime');
    expect(byTarget.get('value')).toBe('omitted');
    expect(validateRecipeDraft(updated)).toMatchObject({ errors: [], saveable: true });
  });
});
