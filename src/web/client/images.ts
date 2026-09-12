import { imageLimitError, MAX_IMAGES } from "@core/composer";
import { showToast } from "./toasts.ts";

// Attachments live in one hidden file input, so the form posts them without
// any help from htmx. Anything over a megabyte is downscaled first: a phone
// photo is 4 MB of pixels the model cannot use.

const COMPRESS_ABOVE_BYTES = 1024 * 1024;
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

async function downscale(file: File): Promise<File> {
  if (file.size <= COMPRESS_ABOVE_BYTES || file.type === "image/gif") {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return file;
      // JPEG has no alpha; flatten onto white so transparency is not black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = url.slice(url.indexOf(",") + 1);
      // Only worth it when the result really is smaller than the original.
      if (base64.length >= Math.ceil(file.size / 3) * 4) return file;
      const bytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
      return new File([bytes], `${file.name}.jpg`, { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

export type Attachments = {
  add(files: readonly File[]): void;
  clear(): void;
  count(): number;
};

export function setUpImages(
  changed: () => void,
  owner: ParentNode = document,
  signal?: AbortSignal,
): Attachments {
  const input = owner.querySelector<HTMLInputElement>("#image-input");
  const previews = owner.querySelector<HTMLElement>("#image-previews");
  const attached: File[] = [];
  let initializing = true;
  let generation = 0;
  signal?.addEventListener(
    "abort",
    () => {
      generation += 1;
      for (const image of previews?.querySelectorAll("img") ?? [])
        URL.revokeObjectURL(image.src);
    },
    { once: true },
  );

  function paint(): void {
    if (signal?.aborted || !input || !previews) return;
    const transfer = new DataTransfer();
    for (const file of attached) transfer.items.add(file);
    input.files = transfer.files;
    for (const url of previews.querySelectorAll("img")) {
      URL.revokeObjectURL(url.src);
    }
    previews.replaceChildren();
    previews.hidden = attached.length === 0;
    for (const file of attached) {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative; flex-shrink:0";
      const image = document.createElement("img");
      image.src = URL.createObjectURL(file);
      image.alt = "";
      image.style.cssText =
        "width:56px; height:56px; object-fit:cover; border-radius:6px; border:1px solid var(--border); display:block";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.style.cssText =
        "position:absolute; top:-4px; right:-4px; width:16px; height:16px; border-radius:50%; background:var(--bg-panel); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; color:var(--text-muted)";
      // views/icons.tsx #49, drawn here because the strip is built in the
      // browser: the files never reach the server before they are sent.
      remove.innerHTML =
        '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="1" y1="1" x2="7" y2="7"></line><line x1="7" y1="1" x2="1" y2="7"></line></svg>';
      remove.setAttribute("aria-label", "Remove image");
      // By identity, never by the index this closure was built with: a
      // downscale finishing in the meantime renumbers the list.
      remove.addEventListener(
        "click",
        () => {
          const at = attached.indexOf(file);
          if (at === -1) return;
          attached.splice(at, 1);
          paint();
        },
        { signal },
      );
      wrapper.append(image, remove);
      previews.append(wrapper);
    }
    input
      .closest("#composer")
      ?.toggleAttribute("data-has-images", attached.length > 0);
    // An attachment turns the send button on, and turns `!` shell mode off.
    if (!initializing) changed();
  }

  function add(files: readonly File[]): void {
    if (signal?.aborted) return;
    const version = generation;
    const room = MAX_IMAGES - attached.length;
    const accepted = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(room, 0));
    if (accepted.length < files.length) {
      showToast(`At most ${String(MAX_IMAGES)} images per message.`, "warning");
    }
    if (accepted.length === 0) return;
    void Promise.all(accepted.map(downscale)).then((processed) => {
      if (signal?.aborted || version !== generation) return;
      const problem = imageLimitError(
        [...attached, ...processed].map((file) => ({
          mimeType: file.type,
          bytes: file.size,
        })),
      );
      if (problem) {
        showToast(problem, "warning");
        return;
      }
      attached.push(...processed);
      paint();
    });
  }

  input?.addEventListener(
    "change",
    () => {
      const picked = [...(input.files ?? [])];
      // The input is also where the form reads from; take the pick and rebuild.
      input.value = "";
      add(picked);
    },
    { signal },
  );
  owner.querySelector("#attach-image")?.addEventListener(
    "click",
    () => {
      input?.click();
    },
    { signal },
  );
  document.addEventListener(
    "paste",
    (event) => {
      const items = [...(event.clipboardData?.items ?? [])].filter((item) =>
        item.type.startsWith("image/"),
      );
      if (items.length === 0) return;
      event.preventDefault();
      add(
        items.map((item) => item.getAsFile()).filter((file) => file !== null),
      );
    },
    { signal },
  );
  // Images a recall took back out of the queue arrive as base64 in a hidden
  // element; they become Files again so the next send carries them. The
  // fragment rides out of band. Every swap task emits a settle event;
  // draining the holder makes repeated events harmless.
  const drainRecalled = (): void => {
    if (signal?.aborted) return;
    const target =
      owner.querySelector("#recalled-images") ??
      document.getElementById("recalled-images");
    if (!target?.firstElementChild) return;
    const recalled: File[] = [];
    for (const item of target.querySelectorAll<HTMLElement>("[data-image]")) {
      const data = item.dataset["image"] ?? "";
      const mime = item.dataset["mime"] ?? "image/png";
      if (data === "") continue;
      try {
        const bytes = Uint8Array.from(atob(data), (c) => c.codePointAt(0) ?? 0);
        recalled.push(
          new File([bytes], `recalled.${mime.split("/")[1] ?? "png"}`, {
            type: mime,
          }),
        );
      } catch {
        // A payload the browser cannot decode is simply not restored.
      }
    }
    target.replaceChildren();
    if (recalled.length > 0) {
      attached.push(...recalled);
      paint();
    }
  };
  document.body.addEventListener("htmx:after:settle", drainRecalled, {
    signal,
  });
  drainRecalled();
  initializing = false;

  return {
    add,
    clear() {
      generation += 1;
      attached.length = 0;
      paint();
    },
    count: () => attached.length,
  };
}

/**
 * pi-web's ImagePreview: a click on a transcript image opens it in a modal
 * over the dimmed app, with Escape, a backdrop click and the close button all
 * closing it and handing focus back to the thumbnail.
 */
export function setUpImagePreview(): void {
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLElement>("[data-image-preview]");
    if (!trigger) return;
    const source = trigger.dataset["imagePreview"] ?? "";
    if (source === "") return;
    event.preventDefault();
    openPreview(trigger, source);
  });
}

function openPreview(trigger: HTMLElement, source: string): void {
  const dialog = document.createElement("dialog");
  dialog.className = "image-preview-dialog";
  dialog.setAttribute("aria-label", "Preview image");
  const image = document.createElement("img");
  image.className = "image-preview-image";
  image.src = source;
  // pi-web hands the modal the thumbnail's own alt (ImagePreview.tsx).
  image.alt = trigger.querySelector("img")?.alt ?? "";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "image-preview-close";
  close.title = "Close";
  close.setAttribute("aria-label", "Close");
  // views/icons.tsx #49 at 16px, drawn here because the dialog is built in
  // the browser.
  close.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
  dialog.append(image, close);
  document.body.append(dialog);
  const overflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  trigger.setAttribute("aria-expanded", "true");
  const dismiss = () => {
    if (dialog.open) dialog.close();
  };
  close.addEventListener("click", dismiss);
  // Only the dialog box itself: a click on the image inside it bubbles here
  // with the image as its target.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dismiss();
  });
  // Escape must not also reach the shell, which would close something else.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  dialog.addEventListener("close", () => {
    document.body.style.overflow = overflow;
    dialog.remove();
    trigger.setAttribute("aria-expanded", "false");
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  });
  dialog.showModal();
  close.focus({ preventScroll: true });
}
