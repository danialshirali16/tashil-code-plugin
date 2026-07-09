# How to Connect a Component

This guide explains how to connect a Figma component to Storybook using the **Tashil Code** plugin.

## Goal

After a component is connected, developers can select an instance in Figma Dev Mode and choose **Tashil UI** in the Code section. The plugin will show a production usage snippet, for example:

```tsx
import { Button } from 'tashil-ui';

<Button intent="primary" variant="solid" size="md">
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

   **Component name**
   The React component name.

   ```txt
   Button
   ```

   **Import path**
   The package or module import path.

   ```txt
   tashil-ui
   ```

   **Storybook URL**
   The matching Storybook story or docs URL.

   ```txt
   https://storybook.example.com/?path=/story/components-button--primary
   ```

   **Source path**
   The source file path in the codebase.

   ```txt
   src/components/Button/Button.tsx
   ```

   **Prop mappings JSON**
   Maps Figma variant properties to React props.

   You can write this JSON by hand, or click **Generate from component** to
   scaffold a mapping skeleton from the selected component's variant properties.
   Each variant property becomes a mapping group; every option maps to a React
   prop of the same name. Generated mappings are merged into the field, so any
   keys you already wrote are preserved — edit the values afterwards as needed.

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

5. Click **Save**.

The plugin stores the connection metadata on the selected Figma component using shared plugin data.

## Test in Dev Mode

1. Switch to Figma Dev Mode.
2. Select an instance of the connected component.
3. Open the Code section.
4. Choose **Tashil UI**.
5. Confirm that the generated snippet uses the correct component name, import path, and props.

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
import { Button } from 'tashil-ui';

<Button intent="primary" variant="solid" size="sm">
  Button
</Button>
```

## Troubleshooting

**The fields are disabled**

The plugin could not find a selected component. Select a main component, component set, or instance, then click **Refresh**.

**Dev Mode says the component is not connected**

The selected instance may point to a different main component or component set. Reopen **Connect component** on the main component set and save again.

**Generated props are missing**

Check that the Figma property names and values exactly match the JSON keys. For example, `Primary` and `primary` are different.

**Codegen times out**

Run `npm run build`, re-import the plugin from `manifest.json`, then try again.

## Stored Metadata Shape

The plugin stores this JSON shape internally:

```json
{
  "schemaVersion": 2,
  "componentName": "Button",
  "importPath": "tashil-ui",
  "storybookUrl": "https://storybook.example.com/?path=/story/components-button--primary",
  "sourcePath": "src/components/Button/Button.tsx",
  "updatedAt": "2026-07-04T08:45:00.000Z",
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
