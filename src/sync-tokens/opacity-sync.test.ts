import { describe, expect, it } from 'vitest';
import { formatColor, formatNumber, serializeCollection } from './serialize';
import { serializeTokenCollection } from './serialize-formats';
import type { ExportOptions, Token, TokenCollection } from './types';

describe('Opacity in Sync Tokens', () => {
  const baseOptions: ExportOptions = {
    colorFormat: 'rgba',
    convertPxToRem: true,
    modesByCollection: {},
    nameStyle: 'lower-hyphen',
    rootFontSize: 16,
  };

  describe('Independent Opacity Tokens (FLOAT variables)', () => {
    it('preserves unitless float opacity (0.38) even when convertPxToRem is true', () => {
      const opacityToken: Token = {
        id: 'var-opacity-disabled',
        name: 'opacity/disabled',
        resolvedType: 'FLOAT',
        scopes: ['OPACITY'],
        value: { kind: 'number', value: 0.38 },
      };

      // Even with convertPxToRem = true, OPACITY scope is NOT in LENGTH_SCOPES
      const formatted = formatNumber(0.38, opacityToken, baseOptions);
      expect(formatted).toBe('0.38');
    });

    it('preserves percentage opacity (50) unitless when convertPxToRem is true', () => {
      const opacityToken: Token = {
        id: 'var-opacity-50',
        name: 'opacity/half',
        resolvedType: 'FLOAT',
        scopes: ['OPACITY'],
        value: { kind: 'number', value: 50 },
      };

      const formatted = formatNumber(50, opacityToken, baseOptions);
      expect(formatted).toBe('50');
    });

    it('preserves unitless opacity when scope is ALL_SCOPES (Figma default) without length conversion', () => {
      const defaultScopeToken: Token = {
        id: 'var-opacity-default',
        name: 'opacity/modal',
        resolvedType: 'FLOAT',
        scopes: ['ALL_SCOPES'],
        value: { kind: 'number', value: 0.6 },
      };

      // ALL_SCOPES is not in LENGTH_SCOPES, so it stays unitless
      const formatted = formatNumber(0.6, defaultScopeToken, baseOptions);
      expect(formatted).toBe('0.6');
    });

    it('exports opacity tokens across all output formats correctly', () => {
      const opacityCollection: TokenCollection = {
        defaultModeId: 'default',
        id: 'opacity-collection',
        modes: [{ modeId: 'default', name: 'Default' }],
        name: 'Opacity Tokens',
        tokens: [
          {
            id: 'op-0',
            name: 'opacity/transparent',
            resolvedType: 'FLOAT',
            scopes: ['OPACITY'],
            value: { kind: 'number', value: 0 },
          },
          {
            id: 'op-disabled',
            name: 'opacity/disabled',
            resolvedType: 'FLOAT',
            scopes: ['OPACITY'],
            value: { kind: 'number', value: 0.38 },
          },
          {
            id: 'op-scrim',
            name: 'opacity/scrim',
            resolvedType: 'FLOAT',
            scopes: ['OPACITY'],
            value: { kind: 'number', value: 0.7 },
          },
          {
            id: 'op-solid',
            name: 'opacity/solid',
            resolvedType: 'FLOAT',
            scopes: ['OPACITY'],
            value: { kind: 'number', value: 1 },
          },
        ],
      };

      // 1. CSS
      const css = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'css' });
      expect(css.extension).toBe('css');
      expect(css.content).toContain('--opacity-transparent: 0;');
      expect(css.content).toContain('--opacity-disabled: 0.38;');
      expect(css.content).toContain('--opacity-scrim: 0.7;');
      expect(css.content).toContain('--opacity-solid: 1;');

      // 2. SCSS
      const scss = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'scss' });
      expect(scss.extension).toBe('scss');
      expect(scss.content).toContain('$opacity-disabled: 0.38;');
      expect(scss.content).toContain('"opacity-disabled": $opacity-disabled');

      // 3. Tailwind Theme
      const tailwind = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'tailwind-theme' });
      expect(tailwind.extension).toBe('ts');
      expect(tailwind.content).toContain('"opacity-disabled": "0.38"');
      expect(tailwind.content).toContain('"opacity-scrim": "0.7"');

      // 4. Flat JSON
      const jsonFlat = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'json-flat' });
      expect(jsonFlat.extension).toBe('json');
      const flatObj = JSON.parse(jsonFlat.content);
      expect(flatObj['opacity-disabled']).toBe('0.38');
      expect(flatObj['opacity-scrim']).toBe('0.7');

      // 5. DTCG JSON
      const jsonDtcg = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'json-dtcg' });
      expect(jsonDtcg.extension).toBe('json');
      const dtcgObj = JSON.parse(jsonDtcg.content) as Record<string, Record<string, { $type: string; $value: string }>>;
      expect(dtcgObj.opacity.disabled).toEqual({ $type: 'number', $value: '0.38' });
      expect(dtcgObj.opacity.scrim).toEqual({ $type: 'number', $value: '0.7' });

      // 6. TypeScript Nested (outputs actual numeric literals for numbers)
      const tsNested = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'typescript-nested' });
      expect(tsNested.extension).toBe('ts');
      expect(tsNested.content).toContain('disabled: 0.38,');
      expect(tsNested.content).toContain('scrim: 0.7,');
      expect(tsNested.content).toContain('transparent: 0,');
      expect(tsNested.content).toContain('solid: 1,');

      // 7. Markdown
      const markdown = serializeTokenCollection(opacityCollection, { ...baseOptions, outputFormat: 'markdown' });
      expect(markdown.extension).toBe('md');
      expect(markdown.content).toContain('--opacity-disabled: 0.38;');
    });
  });

  describe('Color Tokens with Opacity/Alpha', () => {
    const semiTransparentBlue = { r: 0, g: 0.4, b: 1, a: 0.5 };

    it('formats with rgba preserving alpha precision', () => {
      expect(formatColor(semiTransparentBlue, 'rgba')).toBe('rgba(0, 102, 255, 0.5)');
    });

    it('formats with hex appending 2-digit hex alpha channel', () => {
      expect(formatColor(semiTransparentBlue, 'hex')).toBe('#0066ff80');
    });

    it('formats with rgb dropping alpha channel as designed for 3-channel rgb', () => {
      expect(formatColor(semiTransparentBlue, 'rgb')).toBe('rgb(0, 102, 255)');
    });

    it('serializes color with alpha in a collection with multiple formats', () => {
      const colorCollection: TokenCollection = {
        defaultModeId: 'default',
        id: 'color-collection',
        modes: [{ modeId: 'default', name: 'Default' }],
        name: 'Colors',
        tokens: [
          {
            id: 'overlay',
            name: 'color/overlay',
            resolvedType: 'COLOR',
            scopes: ['ALL_FILLS'],
            value: { kind: 'color', value: { r: 0, g: 0, b: 0, a: 0.4 } },
          },
          {
            id: 'highlight',
            name: 'color/highlight',
            resolvedType: 'COLOR',
            scopes: ['ALL_FILLS'],
            value: { kind: 'color', value: { r: 1, g: 0.8, b: 0, a: 0.25 } },
          },
        ],
      };

      // With rgba format
      const cssRgba = serializeTokenCollection(colorCollection, { ...baseOptions, colorFormat: 'rgba' });
      expect(cssRgba.content).toContain('--color-overlay: rgba(0, 0, 0, 0.4);');
      expect(cssRgba.content).toContain('--color-highlight: rgba(255, 204, 0, 0.25);');

      // With hex format (8 digits)
      const cssHex = serializeTokenCollection(colorCollection, { ...baseOptions, colorFormat: 'hex' });
      expect(cssHex.content).toContain('--color-overlay: #00000066;');
      expect(cssHex.content).toContain('--color-highlight: #ffcc0040;');
    });
  });

  describe('Mixed Collection (Length tokens converted to rem, Opacity tokens left unitless)', () => {
    it('converts spacing/radius to rem while keeping opacity unitless in the exact same collection', () => {
      const mixedCollection: TokenCollection = {
        defaultModeId: 'default',
        id: 'mixed-collection',
        modes: [{ modeId: 'default', name: 'Default' }],
        name: 'Design System Foundations',
        tokens: [
          {
            id: 'spacing-md',
            name: 'spacing/medium',
            resolvedType: 'FLOAT',
            scopes: ['GAP', 'WIDTH_HEIGHT'],
            value: { kind: 'number', value: 16 },
          },
          {
            id: 'radius-sm',
            name: 'radius/small',
            resolvedType: 'FLOAT',
            scopes: ['CORNER_RADIUS'],
            value: { kind: 'number', value: 8 },
          },
          {
            id: 'opacity-dim',
            name: 'opacity/dim',
            resolvedType: 'FLOAT',
            scopes: ['OPACITY'],
            value: { kind: 'number', value: 0.4 },
          },
          {
            id: 'surface-glass',
            name: 'surface/glass',
            resolvedType: 'COLOR',
            scopes: ['FRAME_FILL'],
            value: { kind: 'color', value: { r: 1, g: 1, b: 1, a: 0.15 } },
          },
        ],
      };

      const css = serializeCollection(mixedCollection, { ...baseOptions, colorFormat: 'rgba', convertPxToRem: true, rootFontSize: 16 });

      // 16px -> 1rem
      expect(css).toContain('--spacing-medium: 1rem;');
      // 8px -> 0.5rem
      expect(css).toContain('--radius-small: 0.5rem;');
      // Opacity 0.4 -> stays 0.4 without rem!
      expect(css).toContain('--opacity-dim: 0.4;');
      expect(css).not.toContain('--opacity-dim: 0.4rem;');
      expect(css).not.toContain('--opacity-dim: 0.025rem;');
      // Surface glass -> rgba with 0.15 alpha
      expect(css).toContain('--surface-glass: rgba(255, 255, 255, 0.15);');
    });
  });
});
