# Tashil Code

Figma Dev Mode plugin for connecting Figma components to Storybook-backed production components.

The plugin has two workflows:

- **Connect component**: used by design-system owners to save Storybook metadata on a Figma main component or component set.
- **Tashil UI codegen**: used by developers in Dev Mode to see a React/TSX usage snippet for the selected component.

## Development

```sh
npm install
npm run build
```

For continuous builds while testing in Figma:

```sh
npm run watch
```

Import `manifest.json` in Figma from:

`Plugins > Development > Import plugin from manifest...`

## Guides

- [How to connect a component](docs/connect-component.md)
