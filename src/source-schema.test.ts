import { describe, expect, it } from 'vitest';
import { createSourceContentHash, parseSourceComponent } from './source-schema';

const buttonTypes = `
import { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from 'react';

export type ButtonSizeType = 'small' | 'medium' | 'large';
export type ButtonColorType =
  | 'primary'
  | 'secondary'
  | 'neutral'
  | 'success'
  | 'error';
export type ButtonVariantType =
  | 'solid'
  | 'outline'
  | 'tonal'
  | 'ghost'
  | 'link';
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  size?: ButtonSizeType;
  color?: ButtonColorType;
  variant?: ButtonVariantType;
  disabled?: boolean;
  fullWidth?: boolean;
  renderLeftIcon?: ReactNode;
  renderRightIcon?: ReactNode;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
  className?: string;
  iconOnly?: boolean;
}
`;

const buttonImplementation = `
const Button = (props: ButtonProps) => {
  const {
    color = 'primary',
    variant = 'solid',
    fullWidth = false,
    disabled = false,
    loading = false,
    iconOnly = false,
  } = props;
  return null;
};
`;

describe('source schema', () => {
  it('extracts plain-text component and prop JSDoc descriptions', () => {
    const result = parseSourceComponent([{
      fileName: 'Button.tsx',
      contents: '/** Primary action button. */\nexport interface ButtonProps {\n  /** Prevents interaction. */\n  disabled?: boolean;\n}',
    }], 'Button');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.description).toBe('Primary action button.');
      expect(result.snapshot.props[0].description).toBe('Prevents interaction.');
    }
  });
  it('extracts the Volkswagen Button standard prop surface', () => {
    const result = parseSourceComponent([
      { contents: buttonTypes, fileName: 'types.ts' },
      { contents: buttonImplementation, fileName: 'index.tsx' },
    ], 'Button');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.snapshot.componentName).toBe('Button');
    expect(result.snapshot.fileName).toBe('types.ts');
    expect(result.snapshot.props.filter(({ role }) => role === 'standard').map(({ name }) => name))
      .toEqual(['size', 'color', 'variant', 'disabled', 'fullWidth', 'loading', 'iconOnly']);
    expect(result.snapshot.props.find(({ name }) => name === 'color')).toEqual({
      defaultValue: 'primary',
      name: 'color',
      required: false,
      role: 'standard',
      typeName: 'ButtonColorType',
      values: ['primary', 'secondary', 'neutral', 'success', 'error'],
    });
    expect(result.snapshot.props.find(({ name }) => name === 'renderLeftIcon')?.role)
      .toBe('advanced');
    expect(result.snapshot.props.find(({ name }) => name === 'onClick')?.role)
      .toBe('event');
    expect(result.snapshot.props.find(({ name }) => name === 'children')?.role)
      .toBe('children');
    expect(result.snapshot.props.find(({ name }) => name === 'className')?.role)
      .toBe('unsupported');
  });

  it('selects a stable best candidate when multiple prop interfaces exist', () => {
    const result = parseSourceComponent([{
      fileName: 'types.ts',
      contents: 'interface ButtonProps { disabled?: boolean } interface LinkProps { href: string }',
    }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('Button');
    }
  });

  it('uses the only prop interface when the Figma name differs from the code name', () => {
    // The real case: a Figma component named "Dialogbox" implemented by
    // InfoModalProps. An exact-name miss must not dead-end.
    const result = parseSourceComponent(
      [{ fileName: 'types.ts', contents: 'export interface InfoModalProps { title?: string }' }],
      'Dialogbox',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('InfoModal');
      expect(result.warnings.join(' ')).toMatch(/InfoModalProps.*DialogboxProps/);
    }
  });

  it('prefers the interface whose name contains the requested component name', () => {
    const result = parseSourceComponent(
      [{
        fileName: 'types.ts',
        contents: 'interface StyleProps { b?: string } interface InfoModalProps { a?: string } interface DesktopHeaderProps { compact?: boolean }',
      }],
      'Modal',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('InfoModal');
      expect(result.warnings.join(' ')).toMatch(/InfoModalProps.*ModalProps/);
    }
  });

  it('uses an exported source component when its name differs from Figma', () => {
    const result = parseSourceComponent(
      [{
        fileName: 'info-modal.tsx',
        contents: `
interface StyleProps { compact?: boolean }
export interface InfoModalProps { title: string; open: boolean }
export const TashilInfoModal: React.FC<InfoModalProps> = () => null;
`,
      }],
      'Dialogbox',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('TashilInfoModal');
      expect(result.snapshot.propsTypeName).toBe('InfoModalProps');
      expect(result.snapshot.props.map(({ name }) => name)).toEqual(['title', 'open']);
      expect(result.warnings.join(' ')).toMatch(/InfoModalProps.*DialogboxProps/);
    }
  });

  it('falls back to the strongest props declaration when names are unrelated', () => {
    const result = parseSourceComponent(
      [{
        fileName: 'types.ts',
        contents: `
interface StyleProps { compact?: boolean }
export interface InfoModalProps { title: string; open: boolean }
interface DesktopHeaderProps { dense?: boolean }
`,
      }],
      'Dialogbox',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('InfoModal');
      expect(result.snapshot.propsTypeName).toBe('InfoModalProps');
      expect(result.snapshot.props.map(({ name }) => name)).toEqual(['title', 'open']);
    }
  });

  it('creates stable hashes independent of file input order', () => {
    const first = { contents: buttonTypes, fileName: 'types.ts' };
    const second = { contents: buttonImplementation, fileName: 'index.tsx' };
    expect(createSourceContentHash([first, second])).toBe(createSourceContentHash([second, first]));
  });

  it('keeps visual and semantic source selection aligned for type aliases', () => {
    const result = parseSourceComponent([
      {
        contents: `
type Props = {
  checked?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
};
const Checkbox = (props: Props) => null;
export default Checkbox;
`,
        fileName: 'checkbox/index.tsx',
      },
    ], 'Checkbox');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('Checkbox');
      expect(result.snapshot.props.map(({ name, role }) => [name, role])).toEqual([
        ['checked', 'standard'],
        ['onChange', 'event'],
        ['children', 'children'],
      ]);
      expect(result.warnings.join(' ')).toMatch(/Used Props.*CheckboxProps/);
    }
  });

  it('follows a public default alias through a local barrel', () => {
    const result = parseSourceComponent([
      {
        contents: `export { default as PublicCheckbox } from './Checkbox';`,
        fileName: 'checkbox/index.ts',
      },
      {
        contents: `
type InternalProps = { checked?: boolean; label?: string };
const InternalCheckbox = (props: InternalProps) => null;
export default InternalCheckbox;
`,
        fileName: 'checkbox/Checkbox.tsx',
      },
    ], 'PublicCheckbox');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.componentName).toBe('PublicCheckbox');
      expect(result.snapshot.propsTypeName).toBe('InternalProps');
      expect(result.snapshot.props.map(({ name }) => name)).toEqual([
        'checked',
        'label',
      ]);
    }
  });

  it('resolves imported utility types and generic substitutions', () => {
    const result = parseSourceComponent([
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.props).toMatchObject([
        { name: 'value', required: true, values: ['first', 'second'] },
        { name: 'size', required: true, values: ['sm', 'md'] },
        { name: 'disabled', required: false },
      ]);
    }
  });

  it('resolves React intrinsic props from an uploaded @types declaration tree', () => {
    const result = parseSourceComponent([
      {
        contents: `
import type { ComponentPropsWithoutRef } from 'react';
export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  label: string;
}
`,
        fileName: 'workspace/src/button.tsx',
      },
      {
        contents: `
export = React;
export as namespace React;
declare namespace React {
  type ComponentPropsWithoutRef<T extends keyof JSX.IntrinsicElements> =
    JSX.IntrinsicElements[T];
}
declare namespace JSX {
  interface IntrinsicElements {
    button: {
      disabled?: boolean;
      type?: 'button' | 'submit';
      onClick?: (event: unknown) => void;
    };
  }
}
`,
        fileName: 'workspace/node_modules/@types/react/index.d.ts',
      },
    ], 'Button');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.props.map(({ name, required, role }) => ({
        name,
        required,
        role,
      }))).toEqual([
        { name: 'label', required: true, role: 'standard' },
        { name: 'disabled', required: false, role: 'standard' },
        { name: 'type', required: false, role: 'standard' },
        { name: 'onClick', required: false, role: 'event' },
      ]);
      expect(result.warnings.join(' ')).not.toMatch(/ComponentPropsWithoutRef/);
    }
  });

  it('never selects a props declaration from uploaded dependencies', () => {
    const result = parseSourceComponent([
      {
        contents: `
export interface ButtonProps { label: string }
`,
        fileName: 'workspace/src/button.tsx',
      },
      {
        contents: `
export interface ButtonProps { dependencyOnly: boolean }
`,
        fileName: 'workspace/node_modules/@acme/ui/index.d.ts',
      },
    ], 'Button');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.fileName).toBe('workspace/src/button.tsx');
      expect(result.snapshot.props.map(({ name }) => name)).toEqual(['label']);
    }
  });
});
