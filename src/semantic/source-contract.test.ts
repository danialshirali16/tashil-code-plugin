import { describe, expect, it } from 'vitest';
import { extractSourceContract } from './source-contract';

const DIALOG_SOURCE = `
export interface ConfirmationDialogProps {
  intent: 'danger' | 'default';
  title: string;
  description?: string;
  cancelAction: DialogAction;
  confirmAction: { label: string; loading?: boolean };
  onConfirm: () => void;
  className?: string;
}

type DialogAction = { label: string };
`;

function extractDialogContract() {
  const result = extractSourceContract([
    { contents: DIALOG_SOURCE, fileName: 'confirmation-dialog.tsx' },
  ]);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

describe('extractSourceContract', () => {
  it('describes nested object leaves with full paths', () => {
    const { contract } = extractDialogContract();

    expect(contract.componentName).toBe('ConfirmationDialog');
    expect(contract.targets.map((target) => target.path.join('.'))).toEqual([
      'intent',
      'title',
      'description',
      'cancelAction.label',
      'confirmAction.label',
      'confirmAction.loading',
      'onConfirm',
      'className',
    ]);
  });

  it('classifies visual, event, and excluded targets', () => {
    const { contract } = extractDialogContract();
    const byPath = new Map(contract.targets.map((target) => [target.path.join('.'), target]));

    expect(byPath.get('intent')).toMatchObject({
      kind: 'visual',
      required: true,
      values: ['danger', 'default'],
    });
    expect(byPath.get('description')).toMatchObject({ kind: 'visual', required: false });
    expect(byPath.get('onConfirm')).toMatchObject({ kind: 'event', required: true });
    expect(byPath.get('className')).toMatchObject({ kind: 'excluded' });
  });

  it('resolves type-alias object props and records the owning prop', () => {
    const { contract } = extractDialogContract();
    const cancelLabel = contract.targets.find(
      (target) => target.path.join('.') === 'cancelAction.label',
    );

    expect(cancelLabel).toMatchObject({
      insideOptionalObject: false,
      kind: 'visual',
      ownerProp: 'cancelAction',
      required: true,
      typeName: 'string',
    });
  });

  it('marks leaves inside optional parents as optional', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface CardProps {
  action?: { label: string };
}
`,
        fileName: 'card.tsx',
      },
    ]);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets).toEqual([
      {
        insideOptionalObject: true,
        kind: 'visual',
        ownerProp: 'action',
        path: ['action', 'label'],
        required: false,
        typeName: 'string',
      },
    ]);
  });

  it('keeps deeper-than-one-level objects visible as unsupported', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface WidgetProps {
  config: { nested: { deep: string } };
}
`,
        fileName: 'widget.tsx',
      },
    ]);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets).toEqual([
      {
        insideOptionalObject: false,
        kind: 'unsupported',
        ownerProp: 'config',
        path: ['config', 'nested'],
        required: true,
        typeName: '{ deep: string }',
      },
    ]);
  });

  it('rejects files without a Props interface', () => {
    const result = extractSourceContract([
      { contents: 'export const x = 1;', fileName: 'x.ts' },
    ]);

    expect(result).toMatchObject({ ok: false });
  });
});

describe('extractSourceContract heritage and alias resolution', () => {
  it('pulls in props inherited through a plain extends clause', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface BaseProps {
  size?: 'sm' | 'md' | 'lg';
  dir?: 'rtl' | 'ltr';
}
export interface CardProps extends BaseProps {
  title?: string;
}
`,
        fileName: 'card.tsx',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((t) => [t.path.join('.'), t]));
    expect([...byPath.keys()]).toEqual(['title', 'size', 'dir']);
    expect(byPath.get('size')).toMatchObject({ kind: 'visual', values: ['sm', 'md', 'lg'] });
    expect(byPath.get('dir')).toMatchObject({ kind: 'visual', values: ['rtl', 'ltr'] });
  });

  it('resolves extends Omit<Base, keys> and drops the omitted props', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface StyleProps {
  theme: object;
  size?: 'sm' | 'md';
  dir?: 'rtl' | 'ltr';
}
export interface ModalProps extends Omit<StyleProps, 'theme'> {
  open?: boolean;
}
`,
        fileName: 'modal.tsx',
      },
    ], 'Modal');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const names = result.contract.targets.map((t) => t.path.join('.'));
    expect(names).toContain('size');
    expect(names).toContain('dir');
    expect(names).not.toContain('theme');
  });

  it('keeps only the picked props from extends Pick<Base, keys>', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface StyleProps {
  size?: 'sm' | 'md';
  dir?: 'rtl' | 'ltr';
  mode?: 'a' | 'b';
}
export interface WidgetProps extends Pick<StyleProps, 'size'> {
  label?: string;
}
`,
        fileName: 'widget.tsx',
      },
    ], 'Widget');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const names = result.contract.targets.map((t) => t.path.join('.'));
    expect(names).toEqual(['label', 'size']);
  });

  it('lets the child interface override an inherited member', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface BaseProps {
  size?: 'sm' | 'md';
}
export interface CardProps extends BaseProps {
  size?: 'small' | 'large';
}
`,
        fileName: 'card.tsx',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const size = result.contract.targets.filter((t) => t.path.join('.') === 'size');
    expect(size).toHaveLength(1);
    expect(size[0].values).toEqual(['small', 'large']);
  });

  it('resolves imported type aliases across uploaded files', () => {
    const result = extractSourceContract([
      {
        contents: `
import { VariantType } from './button-types';
export interface CardProps {
  variant?: VariantType;
}
`,
        fileName: 'card.tsx',
      },
      {
        contents: `export type VariantType = 'solid' | 'outline' | 'ghost';`,
        fileName: 'button-types.ts',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets.find((t) => t.path.join('.') === 'variant')).toMatchObject({
      kind: 'visual',
      typeName: 'VariantType',
      values: ['solid', 'outline', 'ghost'],
    });
  });

  it('warns but does not fail when a base type cannot be resolved', () => {
    const result = extractSourceContract([
      {
        contents: `
import { ComponentPropsWithoutRef } from 'react';
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'solid' | 'outline';
}
`,
        fileName: 'button.tsx',
      },
    ], 'Button');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets.map((t) => t.path.join('.'))).toEqual(['variant']);
    expect(result.warnings.some((w) => w.includes('ComponentPropsWithoutRef'))).toBe(true);
  });

  it('treats a string | ReactNode union as free-text visual', () => {
    const result = extractSourceContract([
      {
        contents: `
import React from 'react';
export interface CardProps {
  title?: string | React.ReactNode;
}
`,
        fileName: 'card.tsx',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const title = result.contract.targets.find((t) => t.path.join('.') === 'title');
    expect(title).toMatchObject({ kind: 'visual' });
    expect(title?.values).toBeUndefined();
  });

  it('assembles an Omit<Interface, keys> object prop into nested leaves', () => {
    const result = extractSourceContract([
      {
        contents: `
import { ButtonProps } from './button';
export interface ModalProps {
  submitProps?: Omit<ButtonProps, 'children' | 'onClick' | 'size'>;
}
`,
        fileName: 'modal.tsx',
      },
      {
        contents: `
export type ButtonColorType = 'primary' | 'secondary';
export interface ButtonProps {
  size?: 'sm' | 'lg';
  color?: ButtonColorType;
  fullWidth?: boolean;
  onClick?: () => void;
  className?: string;
  children?: string;
}
`,
        fileName: 'button.tsx',
      },
    ], 'Modal');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((t) => [t.path.join('.'), t]));
    // omitted keys are gone; children/onClick/size excluded by the Omit
    expect([...byPath.keys()]).toEqual([
      'submitProps.color',
      'submitProps.fullWidth',
      'submitProps.className',
    ]);
    expect(byPath.get('submitProps.color')).toMatchObject({
      insideOptionalObject: true,
      kind: 'visual',
      ownerProp: 'submitProps',
      required: false,
      values: ['primary', 'secondary'],
    });
    // className stays excluded even inside a nested object
    expect(byPath.get('submitProps.className')).toMatchObject({ kind: 'excluded' });
  });

  it('marks a deeper-than-one-level object leaf as unsupported', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface WidgetProps {
  config?: { nested: { deep: string }; flag: boolean };
}
`,
        fileName: 'widget.tsx',
      },
    ], 'Widget');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((t) => [t.path.join('.'), t]));
    expect(byPath.get('config.nested')).toMatchObject({ kind: 'unsupported' });
    expect(byPath.get('config.flag')).toMatchObject({ kind: 'visual', values: [false, true] });
  });

  it('does not treat a plain ReactNode as text (stays a slot)', () => {
    const result = extractSourceContract([
      {
        contents: `
import React from 'react';
export interface CardProps {
  children?: React.ReactNode;
}
`,
        fileName: 'card.tsx',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets.find((t) => t.path.join('.') === 'children'))
      .toMatchObject({ kind: 'node' });
  });
});
