# Independent event release packaging

Phase 8 defines a small, build-time release boundary for the single Buglasan AI event product. It packages the static Vite output as an independently verifiable directory; it does not add a hosting provider, deployment, backend, runtime event selector, shared corpus, or runtime brand switching.

## Contract

[`config/release-package.mjs`](../config/release-package.mjs) provides a validated build-time definition and selector contract. The only checked-in production definition is `buglasan-production`; its package identity, `dist` output, existing Buglasan branding, HTTPS, root entry point, and SPA fallback are unchanged. Production selection is deliberately immutable: neither Vite nor the package scripts read an environment target selector, so production always builds Buglasan. Generic selection requires the caller to name a target explicitly. [`vite.config.ts`](../vite.config.ts) obtains its PWA branding from that fixed production package definition rather than importing deployment branding directly. The contract contains no credentials, browser keys, endpoints, or infrastructure identifiers.

[`scripts/package-event-release.mjs`](../scripts/package-event-release.mjs) validates a completed output directory against a validated package definition. The production CLI always uses the immutable Buglasan definition. Its generic API requires a validated definition and separately rejects a `reference-only` definition unless `allowReference: true` is supplied by the caller. It requires the generated PWA shell (`index.html`, manifest, offline page, and service worker), rejects source maps and credential-shaped content, hashes every artifact in lexical path order, and writes the deterministic `event-release-package.json` integrity manifest. Validation detects a stale manifest; writing intentionally recalculates and replaces one after a successful rebuild. It never reads `.env.local` or any environment file.

Harbor Days remains the existing synthetic/reference-only fixture in [`test/fixtures/phase7-harbor-days.mjs`](../test/fixtures/phase7-harbor-days.mjs). [`test/fixtures/phase8-harbor-release-package.mjs`](../test/fixtures/phase8-harbor-release-package.mjs) adds a test-only `harbor-reference` package target as isolation proof. It is absent from production definitions, Vite selection, and production package commands. Generic selection and generic packaging each reject it unless the caller explicitly permits reference-only use. It cannot become a production package identity, source, deployment target, or acquisition path.

## Release workflow

1. Supply public browser configuration through the build environment only. Do not commit keys or create an environment file for the package step.
2. Run `npm run release:package`. This runs the existing production build, then validates the output and writes its integrity manifest.
3. Upload exactly the resulting `dist/` directory to an HTTPS static host configured to return `index.html` for application history routes.
4. Before upload, run `npm run release:validate` to recheck an already-built directory. Any changed artifact invalidates the previous integrity manifest and fails validation; rerun `npm run release:package` to rebuild and regenerate it.

The release package deliberately preserves existing policy and application semantics: Buglasan’s official-source and disclaimer distinction, English/Cebuano/Filipino support, Asia/Manila current-calendar-year behavior, and Facebook capability states are unchanged. Server credentials, provider keys, trusted tokens, and database secrets remain in trusted runtime configuration and are never package inputs or browser configuration.
