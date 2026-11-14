# Contributing

Run `bun install`, then `bun run fmt`, `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test` and `bun run test:browser` before opening a pull request.
Add a changeset with `bun run changeset` for any change a user of the packages would notice.
Never edit `packages/client/src/schema.gen.ts` by hand.
Regenerate it with `bun run gen` when og's API contract changes.
Package code must not use APIs that exist only in Node, Bun or Deno.

## Licence

og-sdk-js is licensed under the [Apache License 2.0](LICENSE).
By opening a pull request, you agree that your contribution is licensed under it too.
