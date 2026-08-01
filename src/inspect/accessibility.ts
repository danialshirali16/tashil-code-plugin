import type { AccessibilityFinding, NodeCss } from './types';

type Rgb = { r: number; g: number; b: number; a: number };

export function analyzeAccessibility(css: NodeCss, nodeType: string): AccessibilityFinding[] {
  const declarations = [...css.layout, ...css.style];
  const valueOf = (...properties: string[]): string | undefined => {
    for (let index = declarations.length - 1; index >= 0; index -= 1) {
      if (properties.includes(declarations[index].property.toLowerCase())) return declarations[index].value;
    }
    return undefined;
  };
  const findings: AccessibilityFinding[] = [];
  const foreground = parseCssColor(valueOf('color', 'fill'));
  const background = parseCssColor(valueOf('background-color', 'background'));
  if (foreground && background) {
    const opaqueBackground = composite(background, { r: 255, g: 255, b: 255, a: 1 });
    const ratio = contrastRatio(composite(foreground, opaqueBackground), opaqueBackground);
    findings.push({
      check: 'contrast',
      message: ratio >= 7
        ? `Contrast ${ratio.toFixed(2)}:1 — passes WCAG AAA.`
        : ratio >= 4.5
          ? `Contrast ${ratio.toFixed(2)}:1 — passes WCAG AA.`
          : `Contrast ${ratio.toFixed(2)}:1 — below WCAG AA (4.5:1).`,
      status: ratio >= 4.5 ? 'pass' : 'warning',
      value: ratio,
    });
  }
  const width = parsePixels(valueOf('width', 'min-width'));
  const height = parsePixels(valueOf('height', 'min-height'));
  if (width !== undefined && height !== undefined) {
    const passes = width >= 24 && height >= 24;
    findings.push({
      check: 'touch-target',
      message: passes
        ? `Touch target ${width}×${height}px — meets the 24×24px minimum.`
        : `Touch target ${width}×${height}px — below the 24×24px minimum.`,
      status: passes ? 'pass' : 'warning',
      value: Math.min(width, height),
    });
  }
  if (nodeType === 'TEXT') {
    const fontSize = parsePixels(valueOf('font-size'));
    if (fontSize !== undefined) {
      findings.push({
        check: 'font-size',
        message: fontSize >= 12
          ? `Font size ${fontSize}px — meets the 12px readability heuristic.`
          : `Font size ${fontSize}px — below the 12px readability heuristic.`,
        status: fontSize >= 12 ? 'pass' : 'warning',
        value: fontSize,
      });
    }
  }
  return findings;
}

export function contrastRatio(foreground: Pick<Rgb, 'r' | 'g' | 'b'>, background: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseCssColor(value?: string): Rgb | undefined {
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex) {
    const raw = hex[1].length <= 4 ? [...hex[1]].map((part) => part + part).join('') : hex[1];
    if (raw.length !== 6 && raw.length !== 8) return undefined;
    return { r: parseInt(raw.slice(0, 2), 16), g: parseInt(raw.slice(2, 4), 16), b: parseInt(raw.slice(4, 6), 16), a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value.trim());
  if (!rgb) return undefined;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function luminance(color: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function parsePixels(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^([\d.]+)(px|rem)?$/i.exec(value.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  return match[2]?.toLowerCase() === 'rem' ? number * 16 : number;
}
