#!/usr/bin/env sh
# pnpm runs `prepare` for a checkout and for a git dependency alike. Only a
# checkout has husky and the linker, so anywhere else this does nothing.
[ -d .git ] || exit 0

husky
exec node --import tsx scripts/link-host-pi.ts
