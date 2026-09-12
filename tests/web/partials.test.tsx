import {
  CustomFrameBody,
  CustomPanelBody,
  ExtensionDialogBody,
} from "@web/views/Extensions";
import { Partial } from "@web/views/Partial";
import { ShelfBody } from "@web/views/Shelf";
import { html } from "hono/html";
import { describe, expect, it } from "vitest";

describe("native SSE partials", () => {
  it("sends explicit empty clears for absent extension UI", async () => {
    const fragments = [
      <Partial target="#turn" />,
      <Partial target="#extension-dialog">
        <ExtensionDialogBody sessionId="s1" dialog={null} />
      </Partial>,
      <Partial target="#custom-ui">
        <CustomPanelBody sessionId="s1" frame={null} />
      </Partial>,
      <Partial target="#custom-frame">
        <CustomFrameBody frame={null} />
      </Partial>,
    ];
    for (const [index, target] of [
      "#turn",
      "#extension-dialog",
      "#custom-ui",
      "#custom-frame",
    ].entries()) {
      expect(String(await html`${fragments[index]}`)).toBe(
        `<hx-partial hx-target="${target}" hx-swap="innerHTML"></hx-partial>`,
      );
    }
  });

  it("replaces the shelf owner with its empty hidden shell", async () => {
    expect(
      String(
        await html`${(
          <Partial target="#shelf" swap="outerHTML">
            <ShelfBody status={null} />
          </Partial>
        )}`,
      ),
    ).toBe(
      '<hx-partial hx-target="#shelf" hx-swap="outerHTML"><div id="shelf" hidden=""></div></hx-partial>',
    );
  });
});
