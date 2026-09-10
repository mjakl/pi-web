set quiet := true

tailwind := "./node_modules/.bin/tailwindcss -i ./src/web/app.css -o ./static/app.css"
esbuild := "./node_modules/.bin/esbuild src/web/client/main.ts --bundle --format=esm --target=es2022 --outfile=static/client.js"

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
    {{ tailwind }}
    {{ esbuild }} --sourcemap
    node --watch --import tsx src/main.ts & \
    {{ esbuild }} --sourcemap --watch & \
    {{ tailwind }} --watch; \
    kill %1 %2

# DEV: Build the stylesheet once
build-css:
    {{ tailwind }} --minify

# DEV: Build the client script bundle once
build-js:
    {{ esbuild }} --minify

# DEV: Start the production server
start: link-pi build-css build-js
    node --import tsx src/main.ts

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

# QA: The handoff gate: fix, lint, test
qa: link-pi
    just fix
    just lint
    just test

# CI: Non-mutating validation
ci: link-pi build-css build-js
    just lint
    just test
