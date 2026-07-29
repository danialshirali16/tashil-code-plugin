import { describe, expect, it } from 'vitest';
import { getAcceptedComponentNames } from './component-compatibility';
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
  it('extracts the standalone Icon name catalog from IconNames', () => {
    const result = extractSourceContract([
      {
        contents: `
export type IconNames = '' | 'plus' | 'trash';
export type IconProps = {
  color?: string;
  size?: number;
  name: IconNames;
};
`,
        fileName: 'icon/Icon.types.ts',
      },
    ], 'Icon');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.componentName).toBe('Icon');
      expect(result.contract.propsTypeName).toBe('IconProps');
      expect(result.contract.targets.find((target) => target.path[0] === 'name'))
        .toMatchObject({
          kind: 'visual',
          required: true,
          typeName: 'IconNames',
          values: ['', 'plus', 'trash'],
        });
    }
  });

  it('reads explicit connected-component constraints from ReactElement types', () => {
    expect(
      getAcceptedComponentNames(
        'React.ReactElement<ButtonProps, typeof Components.Button> | ReactElement<LinkProps, typeof Link>',
      ),
    ).toEqual(['Button', 'Link']);
    expect(getAcceptedComponentNames('ReactNode')).toEqual([]);
  });

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

    expect(result.contract.targets).toMatchObject([
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

  it('recursively exposes deeper object leaves', () => {
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
        kind: 'visual',
        ownerProp: 'config',
        path: ['config', 'nested', 'deep'],
        required: true,
        typeName: 'string',
      },
    ]);
  });

  it('uses the only prop interface when the Figma name differs from the code name', () => {
    const result = extractSourceContract(
      [{ fileName: 'types.ts', contents: 'export interface InfoModalProps { title?: string }' }],
      'Dialogbox',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.componentName).toBe('InfoModal');
      expect(result.warnings.join(' ')).toMatch(/InfoModalProps.*DialogboxProps/);
      expect(result.contract.targets.map((t) => t.path.join('.'))).toEqual(['title']);
    }
  });

  it('prefers the interface whose name contains the requested component name', () => {
    const result = extractSourceContract(
      [{
        fileName: 'types.ts',
        contents: 'interface StyleProps { b?: string } interface InfoModalProps { a?: string } interface DesktopHeaderProps { compact?: boolean }',
      }],
      'Modal',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.componentName).toBe('InfoModal');
      expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual(['a']);
      expect(result.warnings.join(' ')).toMatch(/InfoModalProps.*ModalProps/);
    }
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

  it('preserves optional boundaries while recursively exposing deep leaves', () => {
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
    expect(byPath.get('config.nested.deep')).toMatchObject({
      insideOptionalObject: true,
      kind: 'visual',
      required: false,
    });
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

describe('extractSourceContract public component props inference', () => {
  it('reads a type-alias intersection inferred from a React.FC declaration', () => {
    const result = extractSourceContract([
      {
        contents: `
type TypographyProps = {
  variant?: 'body' | 'title';
  children: React.ReactNode;
  color?: string;
} & React.HTMLAttributes<HTMLElement>;

export const Text: React.FC<TypographyProps> = (props) => null;
`,
        fileName: 'text/index.tsx',
      },
    ], 'Text');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('TypographyProps');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'variant',
      'children',
      'color',
    ]);
  });

  it('infers an alternative props name from a function parameter', () => {
    const result = extractSourceContract([
      {
        contents: `
export type ICountdownProps = {
  title?: string;
  animate?: boolean;
  onComplete?: () => void;
};

export function Countdown(props: ICountdownProps) {
  return null;
}
`,
        fileName: 'countdown/index.tsx',
      },
    ], 'Countdown');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('ICountdownProps');
    expect(result.contract.targets.map(({ kind, path }) => [
      path.join('.'),
      kind,
    ])).toEqual([
      ['title', 'visual'],
      ['animate', 'visual'],
      ['onComplete', 'event'],
    ]);
  });

  it('keeps same-named local Props aliases bound to the requested component file', () => {
    const result = extractSourceContract([
      {
        contents: `
type Props = { value: string };
const Radio = (props: Props) => null;
export default Radio;
`,
        fileName: 'radio-group/Radio.tsx',
      },
      {
        contents: `
type Props = { legendText?: string; direction?: 'vertical' | 'horizontal' };
const RadioGroup = (props: Props) => null;
export default RadioGroup;
`,
        fileName: 'radio-group/RadioGroup.tsx',
      },
    ], 'RadioGroup');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('Props');
    expect(result.contract.fileName).toBe('radio-group/RadioGroup.tsx');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'legendText',
      'direction',
    ]);
  });

  it('infers props from the callback passed to forwardRef', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface StepperPropsType {
  transition: 'vertical' | 'horizontal';
  currentPosition: number;
}
export const TashilStepper = React.forwardRef(
  (props: StepperPropsType, ref) => null,
);
`,
        fileName: 'tashil-stepper/index.tsx',
      },
    ], 'TashilStepper');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('StepperPropsType');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'transition',
      'currentPosition',
    ]);
  });

  it('selects the nested component contract instead of a sibling public contract', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface TashilUploadProps { files: File[] }
export type FileStatus = 'default' | 'uploaded' | 'uploading' | 'failed';
export interface SelectedItemProps {
  file?: File;
  fileId?: string;
  size?: 'medium' | 'small';
  disabled?: boolean;
  onRemove: (fileKey: number | string) => void;
  onRetry: (fileName: string) => void;
  status: FileStatus;
  uploadProgress?: number;
}
`,
        fileName: 'tashil-upload/types.ts',
      },
      {
        contents: `
export const SingleFilePreview: FunctionComponent<SelectedItemProps> = (props) => null;
`,
        fileName: 'tashil-upload/modules/single-preview/index.tsx',
      },
    ], 'SingleFilePreview');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('SelectedItemProps');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'file',
      'fileId',
      'size',
      'disabled',
      'onRemove',
      'onRetry',
      'status',
      'uploadProgress',
    ]);
    expect(result.contract.targets).toMatchObject([
      { kind: 'file', required: false, typeName: 'File' },
      { kind: 'visual', required: false, typeName: 'string' },
      { kind: 'visual', required: false, values: ['medium', 'small'] },
      { kind: 'visual', required: false, typeName: 'boolean' },
      { kind: 'event', required: true },
      { kind: 'event', required: true },
      {
        kind: 'visual',
        required: true,
        typeName: 'FileStatus',
        values: ['default', 'uploaded', 'uploading', 'failed'],
      },
      { kind: 'visual', required: false, typeName: 'number' },
    ]);
  });

  it('follows a default export alias to the correct file-scoped Props alias', () => {
    const result = extractSourceContract([
      {
        contents: `
export { default as PublicRadioGroup } from './RadioGroup';
`,
        fileName: 'radio-group/index.ts',
      },
      {
        contents: `
type Props = { value: string };
const Radio = (props: Props) => null;
export default Radio;
`,
        fileName: 'radio-group/Radio.tsx',
      },
      {
        contents: `
type Props = { legendText?: string; direction?: 'vertical' | 'horizontal' };
const InternalRadioGroup = (props: Props) => null;
export default InternalRadioGroup;
`,
        fileName: 'radio-group/RadioGroup.tsx',
      },
    ], 'PublicRadioGroup');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('Props');
    expect(result.contract.fileName).toBe('radio-group/RadioGroup.tsx');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'legendText',
      'direction',
    ]);
  });

  it('follows named exports through a barrel chain', () => {
    const result = extractSourceContract([
      {
        contents: `
export { PublicButton } from './components';
`,
        fileName: 'package/index.ts',
      },
      {
        contents: `
export { InternalButton as PublicButton } from './Button';
`,
        fileName: 'package/components/index.ts',
      },
      {
        contents: `
type InternalProps = { intent?: 'primary' | 'danger' };
export const InternalButton: React.FC<InternalProps> = (props) => null;
`,
        fileName: 'package/components/Button.tsx',
      },
      {
        contents: `
interface PublicButtonProps { wrong?: boolean }
`,
        fileName: 'package/components/unrelated.ts',
      },
    ], 'PublicButton');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.propsTypeName).toBe('InternalProps');
    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'intent',
    ]);
  });

  it('terminates safely when barrel exports contain a cycle', () => {
    const result = extractSourceContract([
      {
        contents: `export { Missing } from './b';`,
        fileName: 'cycle/a.ts',
      },
      {
        contents: `export { Missing } from './a';`,
        fileName: 'cycle/b.ts',
      },
    ], 'Missing');

    expect(result).toMatchObject({ ok: false });
  });

  it('resolves imported utility types and generic substitutions', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface BaseProps<T> {
  value: T;
  size?: 'sm' | 'md';
  disabled: boolean;
}
`,
        fileName: 'field/base.ts',
      },
      {
        contents: `
import type { BaseProps } from './base';
export type FieldProps =
  Required<Pick<BaseProps<'first' | 'second'>, 'value' | 'size'>>
  & Partial<Omit<BaseProps<'first' | 'second'>, 'value' | 'size'>>;
export function Field(props: FieldProps) { return null; }
`,
        fileName: 'field/index.tsx',
      },
    ], 'Field');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets).toMatchObject([
      {
        path: ['value'],
        required: true,
        values: ['first', 'second'],
      },
      {
        path: ['size'],
        required: true,
        values: ['sm', 'md'],
      },
      {
        path: ['disabled'],
        required: false,
      },
    ]);
  });

  it('keeps local props and reports a missing imported dependency', () => {
    const result = extractSourceContract([
      {
        contents: `
import type { ExternalProps } from '@missing/ui';
export interface CardProps extends ExternalProps {
  title?: string;
}
`,
        fileName: 'card.tsx',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'title',
    ]);
    expect(result.warnings.join(' ')).toMatch(
      /Could not resolve dependency "@missing\/ui".*local props were preserved/,
    );
  });

  it('terminates recursive prop aliases without expanding them forever', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface TreeProps {
  label: string;
  child?: TreeProps;
}
`,
        fileName: 'tree.tsx',
      },
    ], 'Tree');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets.map((target) => target.path.join('.'))).toEqual([
      'label',
      'child.label',
      'child.child',
    ]);
    expect(
      result.contract.targets[result.contract.targets.length - 1],
    ).toMatchObject({ kind: 'record' });
  });

  it('resolves public props from an uploaded package declaration', () => {
    const result = extractSourceContract([
      {
        contents: `
import type { ExternalProps } from '@acme/ui';
export interface CardProps extends ExternalProps {
  title: string;
}
`,
        fileName: 'workspace/src/card.tsx',
      },
      {
        contents: `
export interface ExternalProps {
  tone?: 'neutral' | 'danger';
  onDismiss?: () => void;
}
`,
        fileName: 'workspace/node_modules/@acme/ui/index.d.ts',
      },
    ], 'Card');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets).toMatchObject([
      { path: ['title'], required: true },
      {
        kind: 'visual',
        path: ['tone'],
        required: false,
        values: ['neutral', 'danger'],
      },
      {
        kind: 'event',
        path: ['onDismiss'],
        required: false,
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('classifies complex public API values without treating them as parser failures', () => {
    const result = extractSourceContract([
      {
        contents: `
interface Item { id: string }
type SxProps = Record<string, string | number>;
export interface ComplexProps {
  items: Item[];
  metadata?: Record<string, unknown>;
  selectedAt: Date | null;
  files?: FileList;
  renderItem: (item: Item) => React.ReactNode;
  component?: React.ComponentType<{ value: string }>;
  sx?: SxProps;
}
`,
        fileName: 'complex.tsx',
      },
    ], 'Complex');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(
      Object.fromEntries(result.contract.targets.map((target) => [
        target.path.join('.'),
        target.kind,
      ])),
    ).toEqual({
      component: 'render',
      files: 'file',
      items: 'array',
      metadata: 'record',
      renderItem: 'render',
      selectedAt: 'date',
      sx: 'styling',
    });
    expect(
      result.contract.targets.find((target) => target.path[0] === 'items')?.itemSchemas,
    ).toEqual([
      { kind: 'record', role: 'item', typeName: 'Item' },
    ]);
    expect(result.contract.targets.some((target) => target.kind === 'unsupported')).toBe(false);
  });

  it('preserves bounded tuple and map item schemas for runtime collection wiring', () => {
    const result = extractSourceContract([
      {
        contents: `
interface Item { id: string }
export interface CollectionProps {
  coordinates: [number, number];
  itemsById: ReadonlyMap<string, Item>;
}
`,
        fileName: 'collections.tsx',
      },
    ], 'Collection');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((target) => [
      target.path.join('.'),
      target,
    ]));
    expect(byPath.get('coordinates')).toMatchObject({
      itemSchemas: [
        { kind: 'visual', role: 'item', typeName: 'number' },
        { kind: 'visual', role: 'item', typeName: 'number' },
      ],
      kind: 'array',
    });
    expect(byPath.get('itemsById')).toMatchObject({
      itemSchemas: [
        { kind: 'visual', role: 'key', typeName: 'string' },
        { kind: 'record', role: 'value', typeName: 'Item' },
      ],
      kind: 'array',
    });
  });

  it('exposes ReactNode fields inside TashilTab component items', () => {
    const result = extractSourceContract([
      {
        contents: `
import * as React from 'react';
export interface TabProps {
  components?: {
    component: React.ReactNode;
    isSelected?: boolean;
  }[];
}
`,
        fileName: 'tashil-tab/types.tsx',
      },
    ], 'Tab');
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.contract.targets).toMatchObject([
      {
        itemSchemas: [
          {
            kind: 'node',
            path: ['component'],
            role: 'item',
            typeName: 'React.ReactNode',
          },
          {
            kind: 'visual',
            path: ['isSelected'],
            role: 'item',
            typeName: 'boolean',
            values: [false, true],
          },
        ],
        kind: 'array',
        ownerProp: 'components',
        path: ['components'],
        required: false,
      },
    ]);
  });

  it('recognizes the Node-typed TashilDropdown empty-state slot', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface DropdownProps {
  clearIcon?: Node;
  popupIcon?: Node;
  noOptionsText?: Node;
  options: Array<any>;
}
`,
        fileName: 'tashil-dropdown/types.tsx',
      },
    ], 'Dropdown');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((target) => [
      target.path.join('.'),
      target,
    ]));
    expect(byPath.get('clearIcon')).toMatchObject({ kind: 'node', typeName: 'Node' });
    expect(byPath.get('popupIcon')).toMatchObject({ kind: 'node', typeName: 'Node' });
    expect(byPath.get('noOptionsText')).toMatchObject({
      kind: 'node',
      required: false,
      typeName: 'Node',
    });
  });

  it('classifies state as controlled only when a compatible callback is public', () => {
    const result = extractSourceContract([
      {
        contents: `
export interface FieldProps {
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onClose: () => void;
  defaultValue?: string;
  selected?: string;
}
`,
        fileName: 'field.tsx',
      },
    ], 'Field');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const byPath = new Map(result.contract.targets.map((target) => [
      target.path.join('.'),
      target,
    ]));
    expect(byPath.get('value')).toMatchObject({
      controlledBy: ['onChange'],
      kind: 'controlled',
    });
    expect(byPath.get('open')).toMatchObject({
      controlledBy: ['onClose'],
      kind: 'controlled',
    });
    expect(byPath.get('defaultValue')).toMatchObject({ kind: 'visual' });
    expect(byPath.get('selected')).toMatchObject({ kind: 'visual' });
  });

  it('keeps recognizable framework values as explicit runtime targets', () => {
    const result = extractSourceContract([
      {
        contents: `
type ModalSlots = {
  paper?: ExternalPaperProps;
};
export interface ModalProps {
  theme?: ExternalTheme;
  anchorEl?: ExternalAnchor;
  TransitionComponent?: ExternalTransitionComponent;
  TransitionProps?: ExternalTransitionProps;
  componentsProps?: ModalSlots;
  mystery?: ExternalUnknown;
}
`,
        fileName: 'modal.tsx',
      },
    ], 'Modal');
    if (!result.ok) {
      throw new Error(result.message);
    }

    const kinds = Object.fromEntries(result.contract.targets.map((target) => [
      target.path.join('.'),
      target.kind,
    ]));
    expect(kinds).toEqual({
      TransitionComponent: 'render',
      TransitionProps: 'environment',
      anchorEl: 'environment',
      'componentsProps.paper': 'environment',
      mystery: 'unsupported',
      theme: 'environment',
    });
  });
});
