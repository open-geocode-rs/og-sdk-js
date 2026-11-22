# Contributing

Run `bun install`, then `bun run fmt`, `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test` and `bun run test:browser` before opening a pull request.
Add a changeset with `bun run changeset` for any change a user of the packages would notice.
Never edit `packages/client/src/schema.gen.ts` by hand.
Regenerate it with `bun run gen` when og's API contract changes.
Package code must not use APIs that exist only in Node, Bun or Deno.

## Clients

`packages/client/src/client.ts` is the client for og's own API.
Its types come from og's contract, and it answers in og's own shape.

Each directory under `packages/client/src/providers` contains a vendor client and its HTTP types.
A vendor client uses the vendor's method names and request shape, and returns the server's JSON untouched.
It never translates, renames or fills in a value.
The translation between a vendor's API and og's data lives in og's server, under `/compat/<vendor>`.
Its request and response types are written from the vendor's documented API, in its `types.ts` file.

Every client is built on `base.ts`, which owns the transport, the plugins and the one error class.
A client imports from `base.ts`, `core.ts` and `errors.ts` only, never from another client.
Run `bun run test:ecosystem` to check that a client still pulls in no other vendor's code.

## Tests

Each provider has paired tests under `packages/client/test/providers`.
`<vendor>.test.ts` replays responses in the vendor's documented shape, kept under `packages/client/test/fixtures`.
Those fixtures are synthetic, so every value in a new one must be made up, never copied from a vendor's documentation.
The Google fixtures are the one exception, credited in `packages/client/test/fixtures/google/NOTICE.md`.
`<vendor>.compat.test.ts` runs against a real og server when `OG_URL` is set, and is skipped without it. Set `OG_USA_URL` to run the National Address Database sample against a USA Pack.

## Licence

og-sdk-js is licensed under the [Apache License 2.0](LICENSE).
By opening a pull request, you agree that your contribution is licensed under it too.
