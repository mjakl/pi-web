import { ansiToHtml, statusLine, stripAnsi } from "@core/ansi";
import { describe, expect, it } from "vitest";

const ESC = "\u001B";

describe("ansi to html", () => {
  it("turns colour and bold into spans and leaves the rest as text", () => {
    expect(ansiToHtml(`${ESC}[32mok${ESC}[0m done`)).toBe(
      '<span style="color:#13703a">ok</span> done',
    );
    expect(ansiToHtml(`${ESC}[1mloud${ESC}[22m quiet`)).toBe(
      '<span style="font-weight:600">loud</span> quiet',
    );
    expect(ansiToHtml(`${ESC}[38;2;10;20;30mrgb${ESC}[39m`)).toBe(
      '<span style="color:rgb(10,20,30)">rgb</span>',
    );
    expect(ansiToHtml(`${ESC}[48;5;21mbg${ESC}[0m`)).toBe(
      '<span style="background-color:rgb(0,0,255)">bg</span>',
    );
  });

  it("escapes everything an extension could put in the text", () => {
    const html = ansiToHtml(`${ESC}[31m<script>alert("x")&</script>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
    expect(html).toContain("&amp;");
  });

  it("drops cursor markers, OSC titles, and other escapes", () => {
    expect(ansiToHtml(`${ESC}_pi:c\u0007here`)).toBe("here");
    expect(ansiToHtml(`${ESC}]0;title\u0007here`)).toBe("here");
    expect(stripAnsi(`${ESC}[1mbold${ESC}[0m ${ESC}_pi:c\u0007x`)).toBe(
      "bold x",
    );
  });
});

describe("status line", () => {
  it("sorts by key, collapses each status, and joins with one space", () => {
    expect(
      statusLine({
        zebra: "last",
        alpha: "first\r\nsecond   part",
        empty: "   ",
        tabs: "a\tb",
      }),
    ).toBe("first second part a b last");
  });

  it("keeps the escapes for the converter", () => {
    expect(statusLine({ git: `${ESC}[32mmain${ESC}[0m` })).toContain(ESC);
  });
});
