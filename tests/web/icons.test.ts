import { describe, expect, it } from "vitest";
import {
  CompactIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  StarIcon,
  ThemeIcon,
} from "@web/views/icons";

/**
 * The icons are pi-web's, traced by hand: a wrong viewBox or stroke width is a
 * visible difference, so the numbers are asserted rather than the markup.
 */
describe("icons", () => {
  const render = (node: unknown) => String(node);

  it("keeps pi-web's geometry", () => {
    const plus = render(PlusIcon({}));
    expect(plus).toContain('viewBox="0 0 12 12"');
    expect(plus).toContain('stroke-width="2.2"');
    expect(plus).toContain('width="12"');

    const star = render(StarIcon({ filled: true }));
    expect(star).toContain('fill="currentColor"');
    expect(star).toContain("m12 3 2.78 5.63L21 9.54l-4.5 4.39L17.56 20 12");

    const compact = render(CompactIcon({}));
    expect(compact).toContain('points="4 14 10 14 10 20"');
    expect(compact).toContain('stroke-width="1.8"');

    expect(render(ThemeIcon({ preference: "dark" }))).toContain(
      "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z",
    );
  });

  it("masks a Catppuccin file icon in both themes, tinted by the CSS", () => {
    const folder = render(FolderIcon({ open: true }));
    expect(folder).toContain('class="catppuccin-file-icon"');
    expect(folder).toContain("/static/icons/catppuccin/latte/_folder_open.svg");
    expect(folder).toContain("/static/icons/catppuccin/mocha/_folder_open.svg");

    expect(render(FileIcon({ name: "main.rs" }))).toContain("latte/rust.svg");
    expect(render(FileIcon({ name: "Dockerfile.dev" }))).toContain(
      "latte/docker.svg",
    );
    expect(render(FileIcon({ name: "vite.config.ts" }))).toContain(
      "latte/config.svg",
    );
    expect(render(FileIcon({ name: "notes.unknown" }))).toContain(
      "latte/_file.svg",
    );
  });
});
