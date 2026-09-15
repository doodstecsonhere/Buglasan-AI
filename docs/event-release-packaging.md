# Independent event release packaging

Phase 8 defines a small, build-time release boundary for independently verifiable static event output. It does not add a hosting provider, deployment, backend, runtime event selector, shared corpus, or runtime brand switching.

## Contract

[`config/release-package.mjs`](../config/release-package.mjs) provides the validated selector registry. It registers `buglasan-production` as the production package (unchanged identity, `dist` output, branding, HTTPS root entry point, and SPA fallback) and `harbor-reference` as synthetic/reference-only. Every build, validation, and package command selects a target explicitly. Harbor additionally requires the literal `reference-only` acknowledgement, so it cannot be selected accidentally. [`vite.config.ts`](../vite.config.ts) obtains PWA branding and output directory from the selected package. The contract contains no credentials, browser keys, endpoints, or infrastructure identifiers.

[`scripts/package-event-release.mjs`](../scripts/package-event-release.mjs) validates a completed output directory against the selected validated package. `npm run validate:deployment -- <target-id> [output-directory] [reference-only]` works for both registry entries; `reference-only` is mandatory for Harbor. [`scripts/build-event-release.mjs`](../scripts/build-event-release.mjs) makes build and package selection use the same target and passes the acknowledgement to Vite only when needed. The package step requires the generated PWA shell (`index.html`, manifest, offline page, and service worker), rejects source maps and credential-shaped content, hashes every artifact in lexical path order, and writes the deterministic `event-release-package.json` integrity manifest. Validation detects a stale manifest; writing intentionally recalculates and replaces one after a successful rebuild.

Harbor Days remains synthetic/reference-only in [`test/fixtures/phase7-harbor-days.mjs`](../test/fixtures/phase7-harbor-days.mjs); [`test/fixtures/phase8-harbor-release-package.mjs`](../test/fixtures/phase8-harbor-release-package.mjs) is a fixture alias for the registered selector. Focused checks scan package identities in both directions and prove a materially different third configuration can use the generic selector with the same reference-only guard. Harbor cannot become a production package identity, source, deployment target, or acquisition path.

## Release workflow

1. Supply public browser configuration through the build environment only. Do not commit keys or create an environment file for the package step.
2. Run `npm run release:package` for Buglasan. For a synthetic Harbor proof build, run `npm run build:deployment -- harbor-reference reference-only`.
3. Upload exactly the resulting `dist/` directory to an HTTPS static host configured to return `index.html` for application history routes.
4. Before upload, run `npm run validate:deployment -- buglasan-production` to recheck an already-built directory. Any changed artifact invalidates the previous integrity manifest and fails validation; rerun the selector-matched build command to rebuild and regenerate it.

The release package deliberately preserves existing policy and application semantics: Buglasan’s official-source and disclaimer distinction, English/Cebuano/Filipino support, Asia/Manila current-calendar-year behavior, and Facebook capability states are unchanged. Server credentials, provider keys, trusted tokens, and database secrets remain in trusted runtime configuration and are never package inputs or browser configuration.
