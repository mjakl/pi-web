set quiet := true

# INFO: List all available commands
default:
    @just --list

# DEV: Check that the pinned Pi SDK matches the host pi on PATH
doctor:
    node --import tsx scripts/doctor.ts

# DEV: Start the server with reload plus the CSS watcher
dev:
    ./node_modules/.bin/tailwindcss -i ./src/web/app.css -o ./static/app.css
    node --watch --import tsx src/main.ts & \
    ./node_modules/.bin/tailwindcss -i ./src/web/app.css -o ./static/app.css --watch; \
    kill %1

# DEV: Build the stylesheet once
build-css:
    ./node_modules/.bin/tailwindcss -i ./src/web/app.css -o ./static/app.css --minify

# DEV: Start the production server
start: build-css
    node --import tsx src/main.ts

# LINT: Formatting, lint, and types
lint:
    pnpm exec oxfmt --check .
    pnpm exec oxlint .
    just typecheck
    node --import tsx scripts/check-doc-path-references.ts

# LINT: Apply lint and format fixes
fix:
    pnpm exec oxlint --fix .
    pnpm exec oxfmt --write .

# LINT: TypeScript only
typecheck:
    pnpm exec tsc --noEmit

# TEST: Whole suite
test:
    pnpm exec vitest run

# TEST: Selected tests, e.g. `just test-one tests/core`
[positional-arguments]
test-one *args:
    pnpm exec vitest run "$@"

# QA: The handoff gate: fix, lint, test
qa:
    just fix
    just lint
    just test

# CI: Non-mutating validation
ci:
    just build-css
    just lint
    just test
