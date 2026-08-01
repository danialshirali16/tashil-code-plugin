import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styled from 'styled-components';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  intent?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
};

const StyledButton = styled.button<Pick<ButtonProps, 'fullWidth' | 'intent' | 'size'>>`
  width: ${({ fullWidth }) => (fullWidth ? '100%' : 'auto')};
  min-height: ${({ size }) => (size === 'large' ? '48px' : size === 'small' ? '32px' : '40px')};
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: ${({ intent }) => (intent === 'secondary' ? '#eaf3ff' : '#0d70d9')};
  color: ${({ intent }) => (intent === 'secondary' ? '#084b91' : '#ffffff')};
  font: inherit;
  font-weight: 650;
  cursor: pointer;
`;

export function Button({
  children,
  fullWidth = false,
  intent = 'primary',
  size = 'medium',
  ...buttonProps
}: ButtonProps) {
  return (
    <StyledButton
      {...buttonProps}
      fullWidth={fullWidth}
      intent={intent}
      size={size}
    >
      {children}
    </StyledButton>
  );
}

