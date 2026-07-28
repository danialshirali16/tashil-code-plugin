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

  it('creates stable hashes independent of file input order', () => {
    const first = { contents: buttonTypes, fileName: 'types.ts' };
    const second = { contents: buttonImplementation, fileName: 'index.tsx' };
    expect(createSourceContentHash([first, second])).toBe(createSourceContentHash([second, first]));
  });
});
