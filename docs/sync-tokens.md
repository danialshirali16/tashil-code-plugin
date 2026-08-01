# Sync Tokens — User Guide

Status: Active
Last updated: 2026-08-01

The **Sync Tokens** tab exports Figma Variables as CSS, flat JSON, W3C DTCG
JSON, SCSS variables/maps, or a Tailwind theme-extension snippet.

## What it does

You pick collections, modes, format, naming, and units. The plugin generates
one file per collection and selected mode, then downloads it.

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

Use **Select all** / **Clear all** to toggle the whole list, or check
individual rows. When search is active, the bulk action states how many visible
results it affects while a separate summary keeps the total selection visible.

### 2. Pick modes (for themed collections)

If a collection has more than one mode (e.g. **Light** and **Dark**), mode
checkboxes appear in its output-file section. Select one or more modes to
export.

- Selecting both **Light** and **Dark** produces **two output files**
  (`colors-light.css` and `colors-dark.css`).
- Selecting one mode produces a single, mode-stable file (`colors-light.css`).
- The collection's **default mode** is selected when you first choose it.

Collections with a single mode show a disabled checked mode — it is always used.

### 3. Set output options and review the preview

The expanded **Output settings** section controls how values are written. The
preview below it is generated from the selected collections and modes by the
same resolver and serializer used for the download.

Each preview file reports:

- selected Figma variables → emitted CSS declarations
- unresolved aliases, unsupported values, and missing mode values
- referenced collections that fell back to a default mode
- numeric values left unitless because their Figma scope did not identify a length
- tokens added, changed, removed, and unchanged since the last local export

Long files are bounded in the UI, but the download always contains the complete
stylesheet.

#### Output format

- **CSS variables** preserves the original `:root` output.
- **JSON — flat** produces one formatted-name/value object.
- **JSON — W3C DTCG** nests the Figma slash path and emits `$type`/`$value`.
- **SCSS variables + map** emits individual `$token` variables and a `$tokens` map.
- **Tailwind theme extension** emits a TypeScript theme snippet under
  `theme.extend.tokens`.

The last-export comparison is informational. It never changes or blocks the
download, and its per-token hashes stay in Figma `clientStorage` for your user.

If a referenced collection has no mode matching the output mode's name, its
warning includes an **Alias mode** dropdown. Choose the intended mode there;
the preview regenerates immediately and the same mapping is applied to the
download. Mappings are scoped to the current output collection and mode, so
one theme can use **Light** while another uses **Dark**.

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
| `slash` | `--color\/text\/primary`   |
| `dot`   | `--color\.text\.primary`   |
| `snake` | `--color_text_primary`     |
| `pascal`| `--ColorTextPrimary`       |

The default `kebab` produces standard CSS-safe identifiers.

### 4. Export

Click **Export**. The button shows how many files you'll get.

- **One file** → downloads immediately (e.g. `colors.css`).
- **Multiple files** (multiple collections, or one collection with multiple
  modes) → bundled into a single **`sync-tokens.zip`**.

Your browser may ask once for permission to download multiple files.
The plugin announces the downloaded filename when packaging completes.

## Output details

### File naming

- `{collection}.css` — a collection that defines only one mode (e.g. `spacing-scale.css`)
- `{collection}-{mode}.css` — a collection that defines multiple modes,
  even when only one is selected
  (e.g. `colors-primitive-light.css`)

Names are slugified: spaces and special characters collapse to hyphens and
lowercase.

### What gets exported

Every variable in each selected collection, for each selected mode. Aliases
(variables that point at other variables) are resolved:

- **Color aliases** → the actual color value is written (so `--color-brand`
  pointing at a primitive gets the primitive's hex), unless you pick the
  **Variable** color format, in which case the alias name is preserved.
- **Non-color aliases** → recursively resolved when possible. If an alias
  cannot be resolved, its `var()` reference is preserved and the preview shows
  a warning.

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
| Preview shows a mode fallback warning | A referenced collection does not have a mode with the selected mode's name, so its default mode was used. Use the warning's **Alias mode** dropdown to choose the intended mode. |
| Preview reports fewer declarations than variables | Open the listed warnings; missing values and unsupported Figma value shapes are skipped instead of fabricating CSS. |
| Opacity / font-weight came out as `rem` | It shouldn't — only length-scoped variables convert. If it does, the variable's scope in Figma is mislabeled. |
| Need another file syntax | Choose CSS, JSON, SCSS, or Tailwind under **Output format**. |
