import { Composer } from "@web/views/Composer";
import { expect, it } from "vitest";
import { area, byId, frame, mount, render, type } from "./helpers.ts";

// The bundle's entry wires the five areas; a page with all of them on it
// ends up with every area alive.

it("sets up every area of the page", async () => {
  const composer = render(Composer({ sessionId: "s1", cwd: "/home/me/proj" }));
  mount(
    `<main data-cwd="/home/me/proj" data-session-id="s1">
      <aside id="sidebar"><div id="session-list"></div></aside>
      <div id="log"><div id="messages"></div><div id="turn"></div></div>
      <div id="toasts"></div>${composer}
      <div id="file-panel" class="right-panel-closed" data-session="s1">
        <div id="file-tabs" hidden></div><div id="file-view"></div>
      </div></main>`,
  );
  await import("@web/client/main");
  frame();
  expect(document.title).toBe("proj - Pi Web");
  expect(document.body.dataset["filePanel"]).toBe("closed");
  expect(document.activeElement).toBe(area());
  type(area(), "hi");
  const send = byId("composer").querySelector(".composer-action-primary");
  expect(send instanceof HTMLButtonElement && send.disabled).toBe(false);
});
