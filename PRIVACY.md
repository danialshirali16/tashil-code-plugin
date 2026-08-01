# Privacy Policy

Last updated: 2026-08-01

Tashil Code is a local-first Figma plugin. It does not operate a server, send
telemetry, use analytics, serve advertising, or make network requests. The
plugin manifest explicitly sets `networkAccess.allowedDomains` to `none`.

## Data the plugin handles

| Data | Where it lives | Who can access it | Retention |
| --- | --- | --- | --- |
| Component connections, mappings, optional Storybook/source references, derived source-property snapshots, hashes, and connection-health metadata | Figma shared plugin data attached to the connected main component or component set | People who can access the Figma file, subject to Figma's permissions | Until a user clears the connection or removes the containing Figma content |
| Output formatting preferences | Figma `clientStorage` for Tashil Code | The current Figma user; it is not written into the shared document | Until the user clears Figma/plugin local data |
| Token-export history | Figma `clientStorage`; only token names and one-way content hashes are retained | The current Figma user; it is not written into the shared document | Until the user clears Figma/plugin local data or later exports replace the history |
| Uploaded TypeScript/TSX source text | Memory in the plugin UI while it is open | The current user | Not persisted by Tashil Code; discarded when the UI session ends |
| Generated code and previews | Memory while the plugin or Dev Mode generation is active | The current user | Not persisted by Tashil Code |
| User-requested exports | A local download chosen by the user | Whoever can access the downloaded file | Controlled by the user and their operating system |
| User-requested clipboard content | The system clipboard | Controlled by the user and their operating system | Controlled by the operating system |

Source uploads are parsed locally. Tashil Code stores only the derived schema,
source filename/path metadata supplied by the user, and a content hash needed
for drift detection. It does not store the uploaded source text in the Figma
document or `clientStorage`.

## Explicit actions

Tashil Code writes shared plugin data only when a user confirms a save, clear,
or reviewed connection import. Connection exports, token files, generated
stories, audit reports, and debug bundles are downloaded only after the user
chooses the corresponding action. Copy actions write only the displayed output
to the clipboard.

## Third parties

Tashil Code runs inside Figma, so Figma's platform and privacy terms govern the
Figma account, files, collaboration, plugin execution environment, and
`clientStorage`. Tashil Code does not send data to Storybook URLs, source URLs,
GitHub, package registries, or any other third party. Saved reference URLs are
metadata until the user explicitly opens them.

## Security and sensitive information

Do not put secrets, access tokens, credentials, or private source contents into
connection names, paths, URLs, or mappings. Exported JSON and debug bundles are
redacted where documented, but users remain responsible for reviewing files
before sharing them.

## Changes and contact

Material changes to this policy will be documented in the repository changelog.
Questions or reports can be filed through the repository's
[privacy and security issue form](https://github.com/danialshirali16/tashil-code-plugin/issues/new?template=privacy.yml).

