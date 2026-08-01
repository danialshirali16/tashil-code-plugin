# Community demo file publication guide

Status: Ready for Figma publication
Last updated: 2026-08-01

This is the source-of-truth checklist for the Tashil Code Community demo file.
The file is an external Figma artifact and cannot be committed as source code;
the companion React project lives in [`examples/quickstart`](../examples/quickstart/README.md).

## File structure

Create a file named **Tashil Code — 5-minute demo** with two pages:

1. **Start here**
   - A numbered six-step walkthrough matching the quick-start README.
   - A link to the plugin Community listing.
   - A privacy callout: local processing, no network access, source text is not
     persisted.
2. **Components and checkout**
   - A `Button` main component or component set with `Intent`, `Size`,
     `Disabled`, and `Label` properties.
   - A `Checkout Card` frame containing heading, price, and a Button instance.
   - Auto layout, named layers, and color/spacing variables so generated output
     demonstrates component connections, layout code, and tokens.

## Connection values

Use these values so the Community file and companion repository stay aligned:

| Field | Value |
| --- | --- |
| Component name | `Button` |
| Import path | `./Button` |
| Source upload | `examples/quickstart/src/Button.tsx` |
| Figma Intent → React intent | `Primary → primary`, `Secondary → secondary` |
| Figma Size → React size | `Small → small`, `Medium → medium`, `Large → large` |
| Figma Disabled → React disabled | `true → true`, `false → false` |
| Figma Label → React children | Text property → `children` |

## Publication checklist

- Duplicate the file into a clean test account and install the marketplace
  plugin rather than a development build.
- Follow only the root README and time the flow from duplication to copied TSX.
- Confirm it finishes in under five minutes.
- Paste the copied module into `examples/quickstart` and run `npm run build`.
- Remove private team-library references, hidden pages, comments, and user data.
- Publish with duplication enabled and add the final Community file URL to the
  root README and `examples/quickstart/README.md`.
- Record the cold-run date and duration below.

## Cold-run record

Pending external publication. Do not mark Phase 7 complete until a published
Community file URL and a successful under-five-minute cold run are recorded.

