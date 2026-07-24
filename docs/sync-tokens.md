# Sync Tokens — User Guide

Status: Active
Last updated: 2026-07-24

The **Sync Tokens** tab exports your Figma Variables as CSS custom properties
(`--my-token`) so you can hand design tokens to engineering in a format they
can drop straight into a stylesheet.

## What it does

You pick which Variable collections to export, choose a few options (color
format, naming, units), and the plugin generates **one CSS file per
collection** and downloads it. Each file looks like this:

```css
/* Colors / Primitive — exported from Figma variables */
:root {
  --color-text-primary: #1a1a1a;
  --color-brand-default: #0d99ff;
  --spacing-4: 0.25rem;
}
```

## Opening the tab

In the plugin window, click the **Sync Tokens** tab at the top, next to
**Components** and **Inspect Code**.

When you open it for the first time, the plugin loads the list of Variable
collections in the current file. If there are none, you'll see an empty state —
create collections in Figma's **Variables** panel first.

## Exporting tokens

### 1. Select collections

The list shows every local Variable collection in the file, each with:

- a checkbox to include it in the export
- the **variable count** (e.g. `(42)`) so you know how much you're exporting
- **type badges** (`color`, `number`, `string`) showing what's inside

Use **Select all** / **Clear all** to toggle the whole list, or check
individual rows.

### 2. Pick modes (for themed collections)

If a collection has more than one mode (e.g. **Light** and **Dark**), a row of
mode chips appears under its name. **Tap one or more** to choose which modes to
export.

- Selecting both **Light** and **Dark** produces **two CSS files**
  (`colors-light.css` and `colors-dark.css`).
- Selecting one mode produces a single file (`colors.css`).
- If you don't tap any chip, the collection's **default mode** is used.

Collections with a single mode have no chips — that mode is always used.

### 3. Set advanced options (optional)

Expand **Advanced settings** to control how values are written. All of these
have sensible defaults; you only need to touch them when you want a specific
output.

#### Convert px to rem

On by default. Length-based number variables (spacing, sizing, corner radius,
font size, gap, etc.) are divided by the **root font size** and written with a
`rem` unit.

- `16` → `1rem` (at the default root size of 16)
- `32` → `2rem`

Only variables Figma marks as length-scoped are converted. Unitless numbers
like opacity (`0.5`) and font-weight (`600`) are left alone — see
[Scope of the conversion](#scope-of-the-conversion) below.

Set **Root font size (px)** to match your project's `html { font-size: … }`.

#### Color format

How color variables are written:

| Format    | Output                         | Notes                                   |
| --------- | ------------------------------ | --------------------------------------- |
| `HEX`     | `#0d99ff`                      | Default. Opaque colors are 6 digits; transparent colors get an alpha pair (`#0d99ff80`). |
| `RGB`     | `rgb(13, 153, 255)`            | Alpha is dropped.                       |
| `RGBA`    | `rgba(13, 153, 255, 0.5)`      | Keeps alpha.                            |
| `Variable`| `var(--color-brand-primary)`   | Resolves to the referenced token's name instead of a literal color. Use this when you want the CSS to reference your own token layer. |

#### Token name style

How Figma's slash-grouped variable names (`Color/Text/Primary`) become CSS
custom-property names:

| Style   | Example output             |
| ------- | -------------------------- |
| `kebab` | `--color-text-primary`     |
| `slash` | `--color/text/primary`     |
| `snake` | `--color_text_primary`     |
| `pascal`| `--ColorTextPrimary`       |

The default `kebab` produces standard CSS-safe identifiers.

### 4. Export

Click **Export**. The button shows how many files you'll get.

- **One file** → downloads immediately (e.g. `colors.css`).
- **Multiple files** (multiple collections, or one collection with multiple
  modes) → bundled into a single **`sync-tokens.zip`**.

Your browser may ask once for permission to download multiple files.

## Output details

### File naming

- `{collection}.css` — single collection, single mode (e.g. `spacing-scale.css`)
- `{collection}-{mode}.css` — single collection, multiple modes
  (e.g. `colors-primitive-light.css`)

Names are slugified: spaces and special characters collapse to hyphens and
lowercase.

### What gets exported

Every variable in each selected collection, for each selected mode. Aliases
(variables that point at other variables) are resolved:

- **Color aliases** → the actual color value is written (so `--color-brand`
  pointing at a primitive gets the primitive's hex), unless you pick the
  **Variable** color format, in which case the alias name is preserved.
- **Non-color aliases** → skipped if they can't be resolved to a concrete
  value.

### Scope of the conversion

"Convert px to rem" only touches number variables whose Figma **scope** is one
of these length types:

`WIDTH_HEIGHT`, `CORNER_RADIUS`, `GAP`, `STROKE_FLOAT`, `FONT_SIZE`,
`LINE_HEIGHT`, `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`.

Everything else numeric — opacity, font-weight, letter-spacing-as-fraction, etc.
— is written as a bare number. This is deliberate: Figma's `FLOAT` type carries
no unit, so a blanket px→rem would corrupt unitless values.

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| "No variable collections in this file." | Create collections in Figma's Variables panel. The tab only sees **local** collections in the current file. |
| "Could not load variable collections." | A Figma API error. Click **Retry**. |
| Export produced fewer files than expected | You may have selected modes that some collections don't define; those are skipped. |
| Opacity / font-weight came out as `rem` | It shouldn't — only length-scoped variables convert. If it does, the variable's scope in Figma is mislabeled. |
| Want `.scss` / `.json` instead | Not supported yet. CSS only for now. |
