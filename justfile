set quiet := true

# pi-web's stylesheets are the pixel spec (src/web/styles); esbuild only
# inlines the @imports. Absolute /static/... urls are the browser's, not
# esbuild's, so they stay external. Target = the browserslist floor.
esbuild-css := "./node_modules/.bin/esbuild src/web/styles/index.css --bundle --target=chrome125,edge125,firefox147,safari26 '--external:/static/*' --outfile=static/app.css"
esbuild := "./node_modules/.bin/esbuild src/web/client/main.ts --bundle --format=esm --target=es2022 --alias:@core=./src/core --outfile=static/client.js"
esbuild-mermaid := "./node_modules/.bin/esbuild src/web/client/mermaid-lib.ts --bundle --format=esm --target=es2022 --outfile=static/mermaid.js"
# The published server: everything bundled except the Pi SDK, which the bin
# links at startup, and the two packages with binary or optional parts. Not
# minified, so a stack trace from an install still names real functions.
esbuild-server := "./node_modules/.bin/esbuild src/server.ts src/cli.ts --bundle --platform=node --format=esm --target=node24 --jsx=automatic --jsx-import-source=hono/jsx --alias:@=./src --alias:@core=./src/core --alias:@adapters=./src/adapters --alias:@web=./src/web '--external:@earendil-works/*' --external:mammoth --external:web-push --external:undici --outdir=dist"
smoke := "WEB_PI_SMOKE=1 pnpm exec vitest run tests/smoke"

# INFO: List all available commands
default:
    @just --list

# DEV: Point node_modules/@earendil-works at the pi on PATH
link-pi:
    node --import tsx scripts/link-host-pi.ts

# DEV: Report which Pi on PATH this checkout compiles and runs against
doctor:
    node --import tsx scripts/doctor.ts

# DEV: Start the server with reload plus the CSS and client-script watchers
dev: link-pi
    {{ esbuild-css }}
    {{ esbuild-mermaid }}
    {{ esbuild }} --sourcemap
    node --watch --import tsx src/server.ts & \
    {{ esbuild }} --sourcemap --watch & \
    {{ esbuild-css }} --watch; \
    kill %1 %2

# DEV: Build the stylesheet once
build-css:
    {{ esbuild-css }} --minify

# DEV: Build the client script bundles once
build-js:
    {{ esbuild }} --minify
    {{ esbuild-mermaid }} --minify

# DEV: Build everything the package ships: assets and dist/
build: link-pi build-css build-js
    {{ esbuild-server }}

# DEV: Start the built server, as the published bin does
start: build
    node dist/server.js

# LINT: Formatting, lint, and types
lint: link-pi typecheck
    pnpm exec oxfmt --check .
    pnpm exec oxlint .
    node --import tsx scripts/check-doc-path-references.ts

# LINT: Apply lint and format fixes
fix:
    pnpm exec oxlint --fix .
    pnpm exec oxfmt --write .

# LINT: TypeScript only
typecheck: link-pi
    pnpm exec tsc --noEmit

# TEST: Whole suite
test: link-pi
    pnpm exec vitest run

# TEST: Selected tests, e.g. `just test-one tests/core`
[positional-arguments]
test-one *args: link-pi
    pnpm exec vitest run "$@"

# TEST: Pack the package, install it, and serve a fixture session from it
smoke: build
    {{ smoke }}

# QA: The handoff gate: fix, lint, test
qa: link-pi
    just fix
    just lint
    just test

# CI: Non-mutating validation
ci: build
    just lint
    just test
    {{ smoke }}
