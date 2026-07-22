# How to Connect a Component

This guide explains how to connect a Figma component to Storybook using the **Tashil Code** plugin.

## Goal

After a component is connected, developers can select an instance in Figma Dev Mode and choose **Tashil UI** in the Code section. The plugin will show a production usage snippet, for example:

```tsx
import { Button } from "tashil-ui";

<Button intent={"primary"} variant={"solid"} size={"md"}>
  Button
</Button>
```

## Before You Start

Make sure:

- The plugin is imported into Figma from `manifest.json`.
- The latest plugin build is available by running `npm run build` or `npm run watch`.
- You are selecting a main component, component set, or component instance in Figma.

## Connect a Component

1. Open the Figma file that contains your design-system component.
2. Select the main component or component set.
   - For variants, selecting the component set is recommended.
   - Example: select the `Button` component set, not only one internal variant.
3. Run:

   `Plugins > Development > Tashil Code > Connect component`

4. Fill the fields:

   **Component name (required)**
   The exported React component name.

   ```txt
   Button
   ```

   **Import path (required)**
   The package or module import path.

   ```txt
   tashil-ui
   ```

   **Storybook URL (optional)**
   The matching Storybook story or docs URL. Use a complete `http://` or
   `https://` address. When provided, it appears in generated reference
   information and can be opened from **Inspect Code**.

   ```txt
   https://storybook.example.com/?path=/story/components-button--primary
   ```

   **Source path (optional)**
   The source file path in the codebase. When provided, it appears in the
   generated reference information.

   ```txt
   src/components/Button/Button.tsx
   ```

   **Source URL (optional)**
   A browser URL for the source file, kept separately from the repository path.
   Use a complete `http://` or `https://` address. The URL can be opened from
   **Inspect Code**, while the source path remains available to copy.

   ```txt
   https://github.com/example/tashil-ui/blob/main/src/components/Button/Button.tsx
   ```

   **Content and icon slots**

   There is currently no separate Children input. When the source exposes
   `children`, connect it directly to the matching Figma text property in
   **Source & prop mappings**. Leading and trailing React icon props appear as
   slot rows and connect to Figma instance-swap properties in the same editor.

   **Source & prop mappings (optional)**

   Upload or drop the component's `.ts`/`.tsx` props file. When types and the
   implementation are split, select both files together. Parsing happens locally;
   only the extracted prop names, types, values, defaults, file name, and content
   hash are persisted. The original source text is not stored.

   The editor groups `children`, leading/trailing icon slots, and standard variant
   props. Connect each code prop to a compatible Figma property, then map its
   source values to Figma variant values. Suggestions use names and values but
   remain editable. **Generate from component** remains available when source is
   not available.

   **Custom wildcard & raw mappings** is only for cases the visual rows cannot
   represent. These mappings are preserved while standard rows are edited.
   **Generated JSON preview** is read-only and shows the combined runtime mapping.

   ```json
   {
     "intent": {
       "primary": { "prop": "intent", "value": "primary" },
       "neutral": { "prop": "intent", "value": "neutral" },
       "positive": { "prop": "intent", "value": "success" },
       "negative": { "prop": "intent", "value": "error" }
     },
     "style": {
       "solid": { "prop": "variant", "value": "solid" },
       "tonal": { "prop": "variant", "value": "tonal" },
       "outline": { "prop": "variant", "value": "outline" },
       "ghost": { "prop": "variant", "value": "ghost" },
       "link": { "prop": "variant", "value": "link" }
     },
     "state": {
       "loading": { "prop": "loading", "value": true },
       "disabled": { "prop": "disabled", "value": true }
     },
     "size": {
       "md": { "prop": "size", "value": "md" },
       "sm": { "prop": "size", "value": "sm" }
     }
   }
   ```

   Each mapping entry needs a valid JSX attribute name in `prop` and a string,
   number, or boolean `value`. An optional `"raw": true` flag emits a string
   value as a TSX expression instead of a quoted string; use it only for valid
   code expressions.

   Button icon instance swaps are handled automatically when `leadingIcon` maps
   to `renderRightIcon` or `trailingIcon` maps to `renderLeftIcon`. These targets
   follow the Button's RTL orientation. The plugin
   reads the currently selected Figma icon component, converts its component
   name to the Swiss Army Knife icon token, and emits an `Icon` React node. The
   visibility properties `hasLeadingIcon` and `hasTrailingIcon` act only as
   guards and are not emitted as React props. For example, a Figma component
   named `ContractCheck` produces:

   ```tsx
   import { Button, Icon } from "@tashilcar/swiss-army-knife";

   <Button renderLeftIcon={<Icon name="contract-check" />}>
     Button
   </Button>
   ```

   The generated mapping JSON remains ordinary JSON. Icon mappings use `*` as
   the option key and `"$instanceSwap"` as a dynamic marker:

   ```json
   {
     "leadingIcon": {
       "*": { "prop": "renderRightIcon", "value": "$instanceSwap" }
     },
     "trailingIcon": {
       "*": { "prop": "renderLeftIcon", "value": "$instanceSwap" }
     }
   }
   ```

   The marker is never emitted into TSX. Codegen replaces it with the live
   instance-swap component, so changing the icon does not require updating its
   component ID or name in the saved mappings.

   Dev Mode and **Inspect Code** show mapping diagnostics separately from the
   pasteable TSX when an active Figma property or value has no mapping. They also
   report when multiple active mappings target the same React prop; that
   conflicting prop is omitted until the mappings use unique targets. The
   selected children mode owns the React `children` prop, and Icon mode also
   owns `aria-label`; mappings targeting those reserved props are omitted and
   reported so generated TSX never supplies them twice.

5. Review connection health:

   - **Healthy** means no known drift or incomplete mapping remains.
   - **Needs review** means source/Figma additions, renames, or incomplete values
     need attention.
   - **Broken** means a removed or incompatible item is still used by a mapping.
   - **Source refresh required** means the saved source snapshot cannot be checked
     until the local source files are uploaded again.

   Use **Review Figma changes** to load the current property schema. Removed source
   or Figma mappings are retained as stale mappings until you explicitly remove
   them. This prevents reconciliation from silently deleting code-generation data.

6. Click **Save**. The revision and validation timestamp advance only after the
   save succeeds.

The plugin stores the connection metadata on the selected Figma component using shared plugin data.

## Test in Dev Mode

1. Switch to Figma Dev Mode.
2. Select an instance of the connected component.
3. Open the Code section.
4. Choose **Tashil UI**.
5. Confirm that the generated snippet uses the correct component name, import path, and props.

The native Dev Mode codegen result keeps references in a plaintext section.
The plugin's **Inspect Code** tab presents valid Storybook and source URLs as
browser actions and provides a separate copy action for the source path.

## How Prop Mapping Works

The plugin reads the selected component instance's Figma component properties.

For example, if Figma has:

```txt
intent = primary
style = solid
size = sm
```

and the mapping is:

```json
{
  "intent": {
    "primary": { "prop": "intent", "value": "primary" }
  },
  "style": {
    "solid": { "prop": "variant", "value": "solid" }
  },
  "size": {
    "sm": { "prop": "size", "value": "sm" }
  }
}
```

then Dev Mode output becomes:

```tsx
import { Button } from "tashil-ui";

<Button intent={"primary"} variant={"solid"} size={"sm"}>
  Button
</Button>
```

## Troubleshooting

**The fields are disabled**

The plugin could not find exactly one connectable selection. Select a main
component, component set, or instance; the form refreshes automatically when the
selection changes. If it does not update, reselect the layer or close and reopen
**Connect component**.

**Dev Mode says the component is not connected**

The selected instance may point to a different main component or component set. Reopen **Connect component** on the main component set and save again.

**Generated props are missing**

Open **Source & prop mappings** and confirm that every required code prop/value is
connected. Review any Broken or Needs review messages. Custom JSON remains
case-sensitive; for example, `Primary` and `primary` are different.

**Codegen times out**

Run `npm run build`, re-import the plugin from `manifest.json`, then try again.

## Stored Metadata Shape

The plugin stores this JSON shape internally. `componentName` and `importPath`
come from the only two required fields. `schemaVersion` and `updatedAt` are
managed by the plugin. `storybookUrl`, `sourcePath`, and `sourceUrl` are omitted
when their optional fields are blank. Reference URLs accept only absolute HTTP
or HTTPS addresses without embedded credentials. `childrenMode` is `"text"`, `"icon-only"`, or
`"none"`. Text and icon modes store `childrenTextProperty`; icon mode also
stores its required named component and import path. The UI stores an empty
`propMappings` object when no mappings are entered. Schema version 4 can also
store a `mappingDocument` containing source/Figma snapshots, visual mappings,
revision, and validation time. Codegen continues to consume `propMappings`.

```json
{
  "schemaVersion": 4,
  "componentName": "Button",
  "importPath": "tashil-ui",
  "storybookUrl": "https://storybook.example.com/?path=/story/components-button--primary",
  "sourcePath": "src/components/Button/Button.tsx",
  "sourceUrl": "https://github.com/example/tashil-ui/blob/main/src/components/Button/Button.tsx",
  "updatedAt": "2026-07-04T08:45:00.000Z",
  "childrenMode": "text",
  "childrenTextProperty": "label",
  "propMappings": {
    "intent": {
      "primary": { "prop": "intent", "value": "primary" }
    },
    "size": {
      "md": { "prop": "size", "value": "md" }
    }
  }
}
```

Icon mode stores the additional required import fields:

```json
{
  "childrenMode": "icon-only",
  "childrenTextProperty": "label",
  "iconComponentName": "TrashIcon",
  "iconImportPath": "tashil-ui/icons"
}
```

No-children mode stores `"childrenMode": "none"` and omits the text/icon
configuration fields.

Within each prop-mapping entry, `prop` and `value` are required. `raw` is an
optional boolean and defaults to `false` when omitted.

Runtime metadata must explicitly use schema version 4. At the persisted-data
boundary only, an absent version is treated as legacy version 1. Versions 1 and
2 are validated against their own historical shapes and migrated in memory;
version 3 is migrated in memory and version 4 passes through unchanged. Version
2 supports text and `"icon-only"`
children (the `"none"` mode starts in version 3). A legacy `"icon-only"`
connection becomes an explicit named `Icon` import from the component's
existing `importPath`, which preserves the old intent without an undefined JSX
identifier. Reopen **Connect component** and verify or replace that migrated
icon name/path with the real export used by your library.

Reading legacy metadata never rewrites the Figma component. A supported legacy
connection upgrades to version 4 only after an explicit, valid save. Malformed
data, invalid version values, unsupported historical shapes, and future schema
versions are shown as stored-connection issues in Connect, Inspect, and Dev
Mode. Saving and clearing are refused in that state so the original shared
plugin data cannot be overwritten, downgraded, or deleted; update the plugin or
repair the data with a compatible version first.

Older structurally valid connections remain readable if they contain a URL that
does not meet the current HTTP(S) rule. Code generation still works, but the URL
is shown as non-actionable until it is corrected and saved again.
