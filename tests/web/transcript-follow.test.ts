import { followsTail, isAtTail } from "@web/client/transcript";
import { describe, expect, it } from "vitest";

// The rule that decides whether the transcript chases its own growth. A
// resize - the file panel opening, an image loading - makes the content
// taller under a reader who never scrolled, and letting go of the tail there
// leaves the last turn hidden behind the composer with the jump button up.

const CLIENT = 600;
const CONTENT = 8000;
const BOTTOM = CONTENT - CLIENT;

describe("followsTail", () => {
  it("holds on while the content grows under a reader at the end", () => {
    // Pinned to the old bottom, then the column narrowed and the content grew.
    expect(followsTail(true, BOTTOM, BOTTOM, CLIENT, CONTENT + 50)).toBe(true);
  });

  it("lets go only when the reader scrolls up", () => {
    expect(followsTail(true, BOTTOM, BOTTOM - 400, CLIENT, CONTENT)).toBe(
      false,
    );
  });

  it("stays let go while the reader scrolls down short of the end", () => {
    expect(followsTail(false, 100, 200, CLIENT, CONTENT)).toBe(false);
  });

  it("takes hold again at the end", () => {
    expect(followsTail(false, BOTTOM - 400, BOTTOM, CLIENT, CONTENT)).toBe(
      true,
    );
  });

  it("counts the last eight pixels as the end", () => {
    expect(isAtTail(BOTTOM - 8, CLIENT, CONTENT)).toBe(true);
    expect(isAtTail(BOTTOM - 9, CLIENT, CONTENT)).toBe(false);
  });
});
