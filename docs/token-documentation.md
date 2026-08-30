# Token Documentation Guide

Status: Active  
Last updated: 2026-08-30

Tashil Code can generate presentation-ready, pixel-accurate design token documentation directly on your Figma canvas or export structured Markdown specifications for your documentation sites (Storybook, Docusaurus, Nextra).

---

## 1. Generating Token Documentation on the Canvas

1. Open the plugin in Figma (<kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>P</kbd> or via the Plugins menu).
2. Switch to the **Docs** tab.
3. In **Documentation library**, choose **Design Tokens** in the scope control and select a
   Variable Collection row (for example `Colors`, `Spacing`, or `Radius`). Use
   the token search field directly below the scope control to narrow long lists.
4. Review the preview card for token counts, mode capacity, frame width specifications, and
   sample section highlights, then click **Generate Document** in the bottom action bar.
5. The plugin will:
   - Construct a structured, presentation-ready specification frame using the Swiss Army Knife design system.
   - Group variables into clean sections matching your exact Figma folder structure and casing (`Surface`, `Border`, `Text`, `font-family`, etc.).
   - Dynamically generate headlines and context-aware section descriptions.
   - Bind all color swatches (`Color Icon`) natively to their corresponding Figma Variables.
   - Set the appearance and variable mode of each Value column to match its respective theme (e.g., `Light`, `Dark`).
   - Automatically place the frame neatly beside your existing documentation, focus it in the viewport, and notify you via a native Figma toast.

---

## 2. In-Place Documentation Updating

When you add new tokens, rename variables, or modify token values in Figma:

1. Select the previously generated documentation frame on your canvas.
2. In the plugin's **Docs** tab, a dedicated reconciliation card reports whether the
   selected document is up to date or highlights detected changes, providing the **Update in place**
   and **Export Markdown** actions.
3. Click **Update in place** in the reconciliation card.
4. The plugin will:
   - Reconcile all text labels, values, and swatch fills in place without moving the frame or disrupting its position on canvas.
   - Preserve custom frame sizing and layout settings.
   - Add new token rows or prune removed variables while preserving auto layout and table alignment.
   - Re-link updated variable bindings and appearance modes.

---

## 3. Exporting Markdown Documentation

If you want code-ready documentation for Storybook or a developer portal:

1. Select a previously generated token-documentation frame on the Figma canvas.
2. In the **Docs** tab, click **Export Markdown** in the reconciliation card.
3. Copy the formatted Markdown tables or save them directly into your documentation repository.

---

## 4. Live Variable Binding & Inspection

- **Real-Time Swatch Updates**: Because swatch fills on the canvas are bound via Figma's Variables API (`figma.variables.setBoundVariableForPaint`), changing a color value in the Figma Local Variables modal instantly updates the swatch on your documentation page.
- **Theme & Mode Switching**: Selecting any `Value` column allows you to switch its theme mode from the right-hand design panel (**Layer / Variable Mode**), allowing interactive review of multi-theme palettes.

---

## 5. Troubleshooting & Best Practices

- **Missing Fonts**: Ensure standard fonts (such as `Inter` or your system font) are installed. The plugin automatically requests and loads required font weights before updating canvas text layers.
- **Master Component Fallbacks**: If the Swiss Army Knife component set is not available in the current file, the plugin automatically falls back to procedural auto-layout frames that maintain visual and dimensional parity.
- **Multiple Collections**: Each Variable Collection can have its own dedicated documentation frame on the canvas. Generating documentation for multiple collections arranges them side-by-side with consistent 100px margins.
