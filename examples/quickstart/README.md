# Tashil Code quick start

This small React project is the code companion for the Tashil Code Community
demo. `src/Button.tsx` is the source contract uploaded while connecting the
demo Button. `src/CheckoutCard.tsx` is representative output from selecting the
connected checkout frame and copying the generated module.

## Run it

```sh
npm install
npm run dev
```

Open the URL printed by Vite. To verify the production sample instead, run:

```sh
npm run build
npm run preview
```

## Reproduce the flow in Figma

1. Duplicate the published Tashil Code Community demo file.
2. Install and run Tashil Code in Design mode.
3. Select the demo Button and open **Connect component**.
4. Use `Button` as the component name and `./Button` as the import path, then
   upload `src/Button.tsx` and save the suggested mappings.
5. Switch to Dev Mode, select the Checkout Card frame, choose **Tashil UI**, and
   copy the generated TSX.
6. Compare it with `src/CheckoutCard.tsx`, or paste the copied module into this
   project and run `npm run build`.

The source file remains local to the plugin session. See the repository
[`PRIVACY.md`](../../PRIVACY.md) for the complete data-handling model.

