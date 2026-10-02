# Changesets

This folder holds the pending release notes of the public npm packages (`emojisense` and
`@emojisense/*`). Tool: [Changesets](https://changesets.dev). Release steps: [RELEASING.md](../RELEASING.md).

- Add a note for each change that users of a package can see: `pnpm changeset`. Choose the packages
  and the bump (patch, minor, major), then write one or two sentences for the changelog.
- `pnpm release:version` turns the notes into new versions and `CHANGELOG.md` entries.
- `pnpm release:publish` publishes the new versions. Only the owner runs it.

Private packages (the Worker, the data pipeline, the apps) are not versioned here.
