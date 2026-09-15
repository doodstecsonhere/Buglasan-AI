# Independent event release packaging

Phase 8 defines a small, build-time release boundary for the single Buglasan AI event product. It packages the static Vite output as an independently verifiable directory; it does not add a hosting provider, deployment, backend, event selector, shared corpus, or runtime brand switching.

## Contract

[`config/release-package.mjs`](../config/release-package.mjs) is the checked-in public contract. It composes the existing Buglasan deployment branding and fixes one package identity, HTTPS, the root entry point, and SPA history fallback. It contains no credentials, browser keys, endpoints, or infrastructure identifiers.

[`scripts/package-event-release.mjs`](../scripts/package-event-release.mjs) accepts only a completed output directory. It requires the generated PWA shell (`index.html`, manifest, offline page, and service worker), rejects source maps and credential-shaped content, hashes every artifact in lexical path order, and writes the deterministic `event-release-package.json` integrity manifest. It never reads `.env.local` or any environment file.

Harbor Days remains the existing synthetic/reference-only fixture in [`test/fixtures/phase7-harbor-days.mjs`](../test/fixtures/phase7-harbor-days.mjs). It is exercised by tests only and cannot become a package identity, source, deployment target, or acquisition path.

## Release workflow

1. Supply public browser configuration through the build environment only. Do not commit keys or create an environment file for the package step.
2. Run `npm run release:package`. This runs the existing production build, then validates the output and writes its integrity manifest.
3. Upload exactly the resulting `dist/` directory to an HTTPS static host configured to return `index.html` for application history routes.
4. Before upload, run `npm run release:validate` to recheck an already-built directory. Any changed artifact invalidates the previous integrity manifest and fails validation; rerun the package workflow to regenerate it.

The release package deliberately preserves existing policy and application semantics: Buglasan’s official-source and disclaimer distinction, English/Cebuano/Filipino support, Asia/Manila current-calendar-year behavior, and Facebook capability states are unchanged. Server credentials, provider keys, trusted tokens, and database secrets remain in trusted runtime configuration and are never package inputs or browser configuration.
