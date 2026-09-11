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

export function setUpImages(): Attachments {
  const input = document.querySelector<HTMLInputElement>("#image-input");
  const previews = document.querySelector<HTMLElement>("#image-previews");
  const attached: File[] = [];

  function paint(): void {
    if (!input || !previews) return;
    const transfer = new DataTransfer();
    for (const file of attached) transfer.items.add(file);
    input.files = transfer.files;
    for (const url of previews.querySelectorAll("img")) {
      URL.revokeObjectURL(url.src);
    }
    previews.replaceChildren();
    for (const file of attached) {
      const wrapper = document.createElement("div");
      wrapper.className = "relative";
      const image = document.createElement("img");
      image.src = URL.createObjectURL(file);
      image.alt = file.name;
      image.style.cssText =
        "width:56px; height:56px; object-fit:cover; border-radius:6px; border:1px solid var(--border); display:block";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.style.cssText =
        "position:absolute; top:-4px; right:-4px; width:16px; height:16px; border-radius:50%; background:var(--bg-panel); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; padding:0; color:var(--text-muted)";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      // By identity, never by the index this closure was built with: a
      // downscale finishing in the meantime renumbers the list.
      remove.addEventListener("click", () => {
        const at = attached.indexOf(file);
        if (at === -1) return;
        attached.splice(at, 1);
        paint();
      });
      wrapper.append(image, remove);
      previews.append(wrapper);
    }
    document
      .querySelector("#composer")
      ?.toggleAttribute("data-has-images", attached.length > 0);
  }

  function add(files: readonly File[]): void {
    const room = MAX_IMAGES - attached.length;
    const accepted = files
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(room, 0));
    if (accepted.length < files.length) {
      showToast(`At most ${String(MAX_IMAGES)} images per message.`, "warning");
    }
    if (accepted.length === 0) return;
    void Promise.all(accepted.map(downscale)).then((processed) => {
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

  input?.addEventListener("change", () => {
    const picked = [...(input.files ?? [])];
    // The input is also where the form reads from; take the pick and rebuild.
    input.value = "";
    add(picked);
  });
  document.querySelector("#attach-image")?.addEventListener("click", () => {
    input?.click();
  });
  document.addEventListener("paste", (event) => {
    const items = [...(event.clipboardData?.items ?? [])].filter((item) =>
      item.type.startsWith("image/"),
    );
    if (items.length === 0) return;
    event.preventDefault();
    add(items.map((item) => item.getAsFile()).filter((file) => file !== null));
  });
  const main = document.querySelector("main");
  main?.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  main?.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  });

  // Images a recall took back out of the queue arrive as base64 in a hidden
  // element; they become Files again so the next send carries them.
  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.id !== "recalled-images") return;
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
    if (recalled.length > 0) add(recalled);
  });

  return {
    add,
    clear() {
      attached.length = 0;
      paint();
    },
    count: () => attached.length,
  };
}
