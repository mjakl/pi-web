set positional-arguments

# A bare `just` lists commands; fixes always require an explicit request.
default:
    @just --list

# Apply supported Oxlint/ESLint fixes, then Oxfmt. Never called by qa or ci.
fix:
    npm run fix

lint:
    npm run lint

typecheck:
    npm run typecheck

# Put Node test-runner options before file paths; quote patterns with spaces.
test-one +args:
    npm run test:one -- "$@"

test:
    npm test

qa:
    npm run qa

ci:
    npm run ci
