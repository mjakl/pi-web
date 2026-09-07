import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
});
const route = await jiti.import("./[...path]/route.ts");
const methods = autoImplementMethods(route);

for (const type of ["upload", "upload-check"]) {
  test(`file API rejects ${type} with the framework's method-not-allowed response`, async () => {
    const response = await methods.POST(
      new Request(`http://localhost/api/files/project?type=${type}`, {
        method: "POST",
        body: "not parsed",
      }),
    );
    assert.equal(response.status, 405);
  });
}
