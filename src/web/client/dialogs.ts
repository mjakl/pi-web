// Dialogs arrive as server-rendered `<dialog open>` elements, which already
// show without script. This upgrades them to real modals: backdrop, focus
// trap, top layer, and focus restore, all from the platform.

export function upgradeDialogs(root: ParentNode | Element = document): void {
  const found =
    root instanceof HTMLDialogElement && root.matches("dialog[data-modal]")
      ? [root]
      : [...root.querySelectorAll<HTMLDialogElement>("dialog[data-modal]")];
  for (const dialog of found) {
    if (dialog.dataset["upgraded"] === "1") continue;
    dialog.dataset["upgraded"] = "1";
    // `showModal` throws on an already-open dialog, so the server's `open`
    // attribute is dropped first. Not with `close()`: that queues a `close`
    // event which would fire after the listener below is attached and take
    // the dialog straight back out of the page.
    dialog.removeAttribute("open");
    dialog.showModal();
    // A page that *is* a dialog (settings) goes back to where it came from;
    // every other dialog is a fragment and simply leaves.
    const back = dialog.dataset["closeHref"];
    dialog.addEventListener("close", () => {
      if (back === undefined) dialog.remove();
      else location.assign(back);
    });
    if (dialog.dataset["backdropClose"] === undefined) continue;
    dialog.addEventListener("click", (event) => {
      // Only the dialog box itself: a click on the panel inside it bubbles
      // here with the panel as its target.
      if (event.target === dialog) dialog.close();
    });
  }
}

export function dialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

export function setUpDialogs(): void {
  upgradeDialogs();
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (target instanceof Element) upgradeDialogs(target);
  });
}
