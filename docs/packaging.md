# Packaging and runtime smoke

Read this before changing `dependencies`, the `build` script, or the `files`
list in [package.json](../package.json). Those changes require proving that the
installed package still starts, in addition to `just ci`.

## Package constraints

- `npm pack` has no build step: it ships whatever `.next/` already contains.
  Build in a scratch copy, never in a development checkout's `.next/`.
- A consumer install has only runtime dependencies. Packages bundled into
  `.next/` are not installed separately, and Pi packages are not included at
  all. The server must reach the host Pi through the runtime preload.
- Keep `--webpack` in the build script. A Turbopack build reaches
  `serverExternalPackages` through `.next/node_modules/<package>-<hash>`
  symlinks that `npm pack` drops.

## Validate the installed artifact

Use the disposable build/install steps in
[the validation workflow](../.github/workflows/validation.yml) and
[scripts/runtime-smoke.test.mjs](../scripts/runtime-smoke.test.mjs):

1. Prepare a scratch copy containing the change being validated. The workflow's
   `git archive HEAD` includes only committed changes; when validating an
   uncommitted change, include those source edits in the scratch copy too.
2. Install the matching host Pi packages outside the scratch checkout and put
   their bin directory on `PATH`. Use temporary HOME and Pi agent directories.
3. With the development toolchain, run `npm ci`, `npm run build`, then
   `npm pack` in the scratch copy.
4. Install the tarball into a separate consumer directory with `--omit=dev`
   using Node 22.19.0, then run:

   ```bash
   PI_WEB_SMOKE_PACKAGE=/path/to/consumer/node_modules/@mjakl/pi-web \
     mise exec node@22.19.0 -- node --test scripts/runtime-smoke.test.mjs
   ```

   Run that command from a source checkout containing the smoke test, not from
   the installed package. Install the minimum Node version first with
   `mise install node@22.19.0` if needed.

5. Remove the disposable build and consumer artifacts after validation.

The smoke starts the installed `pi-web` bin on loopback with temporary HOME/Pi
state. It requests the page and reads a saved session through the host Pi SDK;
it never starts an agent turn or invokes a provider. Keep this check separate
from routine `just ci`.
