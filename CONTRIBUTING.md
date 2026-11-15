# Contributing

Run `bun install`, then `bun run fmt`, `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test` and `bun run test:browser` before opening a pull request.
Add a changeset with `bun run changeset` for any change a user of the packages would notice.
Never edit `packages/client/src/schema.gen.ts` by hand.
Regenerate it with `bun run gen` when og's API contract changes.
Package code must not use APIs that exist only in Node, Bun or Deno.

## Adapters

An adapter translates one provider's API to the unified format in `packages/client/src/types.ts` and does nothing else.
It never makes up a value.
A field the provider did not send is `null`, and a field or option the provider cannot serve is left out of the adapter's `capabilities`.
Its tests replay the provider's documented responses, kept verbatim under `packages/client/test/fixtures`, so do not tidy those files.
Run `bun run docs:capabilities` after changing an adapter's `capabilities`, since the README's provider tables are built from them.
Run `bun run test:ecosystem` to check that an adapter still pulls in no other provider's code.

## Licence

og-sdk-js is licensed under the [Apache License 2.0](LICENSE).
By opening a pull request, you agree that your contribution is licensed under it too.
