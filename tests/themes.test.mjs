import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { THEME_VAR_KEYS, parseTheme } from "../src/utils/themes.ts";

const expectedTokens = [
  ["bg", "--bg"],
  ["bgElevated", "--bg-elevated"],
  ["bgHover", "--bg-hover"],
  ["bgActive", "--bg-active"],
  ["border", "--border"],
  ["borderStrong", "--border-strong"],
  ["text", "--text"],
  ["textDim", "--text-dim"],
  ["textFaint", "--text-faint"],
  ["accent", "--accent"],
  ["accentDim", "--accent-dim"],
  ["danger", "--danger"],
  ["success", "--success"],
  ["selection", "--selection"],
];

const validColors = [
  "#abc", "#ABCD", "#112233", "#11223344",
  "rgb(0, 128, 255)", "rgba(10,20,30,0.5)",
  "rgb(0%, 50%, 100%)", "rgba(10%, 20%, 30%, 50%)",
  "rgb(10 20 30)", "rgb(10 20 30 / 50%)",
  "rgba(10% 20% 30% / .5)", "rgb(10% 20 30 / 1)",
  "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 1)",
  "RGB(0, 128, 255)", "rgb(12.5, +20, 30)",
  "hsl(120, 50%, 25%)", "hsla(-90deg, 100%, 50%, 25%)",
  "hsl(720 0% 100%)", "hsl(.5turn 20% 30% / .4)",
  "hsl(1.2rad 50% 50%)", "hsl(100grad 50% 50%)",
  "HSLA(90DEG, 50%, 50%, 1)", "rgb(\n10\t20 30 / .5\n)",
];

const invalidColors = [
  "", "red", "transparent", "currentColor", "inherit", "initial",
  "url(https://example.com/color)", "var(--bg)", "rgb(calc(1) 0 0)",
  "color(display-p3 1 0 0)", "#abc; color:red", "#abc !important",
  "rgb(1 2 3) trailing", "/* comment */ #abc",
  "#12", "#12345", "#1234567", "#123456789", "#ggg", "123456",
  "rgb(256,0,0)", "rgb(-1,0,0)", "rgb(101% 0% 0%)",
  "rgb(1, 2%, 3)", "rgb(1 2)", "rgb(1 2 3 4)",
  "rgb(1,2,3,)", "rgb(1,2,3 / .5)", "rgb(1 2 3 /)",
  "rgb(1 2 3 / .5 / .5)", "rgba(0 0 0 / 1.1)",
  "rgba(0,0,0,-.1)", "rgba(0,0,0,101%)",
  "hsl(90,50,50)", "hsl(90 101% 50%)", "hsl(90 50% -1%)",
  "hsl(90degjunk 50% 50%)", "hsl(NaN 50% 50%)",
  "hsl(Infinity 50% 50%)", "rgb(NaN 0 0)", "rgb(Infinity 0 0)",
  "rgb(1e999 0 0)", "rgb(none 0 0)",
];

describe("theme token allowlist", () => {
  it("exports exactly the 14 logical keys and their CSS variables", () => {
    assert.deepEqual(THEME_VAR_KEYS, expectedTokens);
  });

  for (const [key] of expectedTokens) {
    it(`accepts the recognized token ${key}`, () => {
      assert.deepEqual(parseTheme({ vars: { [key]: "#abc" } }), {
        name: "", vars: { [key]: "#abc" },
      });
    });
  }
});

describe("theme formats", () => {
  for (const [format, input] of [
    ["flat", { name: "Test", bg: "#123", accent: "#abcdef" }],
    ["colors", { name: "Test", colors: { bg: "#123", accent: "#abcdef" } }],
    ["persisted vars", { name: "Test", vars: { bg: "#123", accent: "#abcdef" } }],
  ]) {
    it(`parses the ${format} format`, () => {
      assert.deepEqual(parseTheme(input), {
        name: "Test", vars: { bg: "#123", accent: "#abcdef" },
      });
    });
  }

  it("prefers colors over vars and flat tokens without merging", () => {
    assert.deepEqual(parseTheme({
      colors: { bg: "#123" }, vars: { accent: "#456" }, text: "#789",
    }), { name: "", vars: { bg: "#123" } });
  });

  it("prefers vars over flat tokens without merging", () => {
    assert.deepEqual(parseTheme({ vars: { bg: "#123" }, accent: "#456" }), {
      name: "", vars: { bg: "#123" },
    });
  });

  it("trims names and colors without mutating the input", () => {
    const colors = Object.freeze({ bg: "  #ABC  " });
    const input = Object.freeze({ name: "  Mi tema  ", colors });
    const parsed = parseTheme(input);
    assert.deepEqual(parsed, { name: "Mi tema", vars: { bg: "#ABC" } });
    parsed.vars.bg = "#def";
    assert.equal(input.colors.bg, "  #ABC  ");
    assert.equal(input.name, "  Mi tema  ");
  });

  for (const name of [undefined, null, 42, "", "   "]) {
    it(`returns an empty name for ${JSON.stringify(name)}`, () => {
      assert.equal(parseTheme({ name, bg: "#abc" }).name, "");
    });
  }

  for (const format of ["flat", "colors", "vars"]) {
    it(`ignores unknown keys in the ${format} format`, () => {
      const tokens = JSON.parse(
        '{"bg":"#abc","unknown":"url(evil)","--bg":"#def","__proto__":{"polluted":true},"constructor":"bad"}',
      );
      const input = format === "flat" ? tokens : { [format]: tokens };
      assert.deepEqual(parseTheme(input), { name: "", vars: { bg: "#abc" } });
      assert.equal(Object.prototype.polluted, undefined);
    });
  }

  it("accepts records with a null prototype", () => {
    const colors = Object.assign(Object.create(null), { bg: "#abc" });
    assert.deepEqual(parseTheme({ colors }), { name: "", vars: { bg: "#abc" } });
  });

  for (const [label, input] of [
    ["empty flat object", {}],
    ["name only", { name: "No colors" }],
    ["empty colors", { colors: {} }],
    ["empty vars", { vars: {} }],
    ["unknown flat tokens", { unknown: "#abc", "--bg": "#abc" }],
    ["unknown colors tokens", { colors: { unknown: "#abc" } }],
    ["unknown vars tokens", { vars: { unknown: "#abc" } }],
    ["empty colors with valid fallback", { colors: {}, vars: { bg: "#abc" } }],
  ]) {
    it(`rejects ${label}`, () => {
      assert.throws(() => parseTheme(input), { message: "THEME_NO_COLORS" });
    });
  }

  for (const input of [null, undefined, [], 1, true, "{\"bg\":\"#abc\"}", new Date()]) {
    it(`rejects a non-record root: ${String(input)}`, () => {
      assert.throws(() => parseTheme(input), { message: "THEME_INVALID_OBJECT" });
    });
  }

  for (const format of ["colors", "vars"]) {
    for (const value of [null, [], "#abc", 42]) {
      it(`rejects invalid ${format}: ${JSON.stringify(value)}, even with a flat fallback`, () => {
        assert.throws(() => parseTheme({ [format]: value, bg: "#abc" }), {
          message: "THEME_INVALID_COLORS",
        });
      });
    }
  }

  it("does not accept inherited tokens", () => {
    assert.throws(() => parseTheme(Object.create({ bg: "#abc" })), {
      message: "THEME_INVALID_OBJECT",
    });
  });
});

describe("theme color validation", () => {
  for (const color of validColors) {
    it(`accepts ${JSON.stringify(color)}`, () => {
      assert.equal(parseTheme({ colors: { bg: color } }).vars.bg, color);
    });
  }

  for (const color of invalidColors) {
    it(`rejects ${JSON.stringify(color)}`, () => {
      assert.throws(() => parseTheme({ colors: { bg: color } }), {
        message: "THEME_INVALID_COLOR:bg",
      });
    });
  }

  for (const value of [null, undefined, 123, true, [], {}]) {
    it(`rejects a non-string token: ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseTheme({ bg: value }), { message: "THEME_INVALID_COLOR:bg" });
    });
  }

  it("rejects the whole theme when one recognized token is invalid", () => {
    assert.throws(() => parseTheme({ colors: { bg: "#abc", text: "var(--text)" } }), {
      message: "THEME_INVALID_COLOR:text",
    });
  });
});

describe("browser color support", () => {
  it("uses CSS.supports when available, but never delegates unsafe syntax", (t) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "CSS");
    t.after(() => {
      if (original) Object.defineProperty(globalThis, "CSS", original);
      else delete globalThis.CSS;
    });

    Object.defineProperty(globalThis, "CSS", { configurable: true, value: undefined });
    assert.equal(parseTheme({ bg: "#abc" }).vars.bg, "#abc");

    Object.defineProperty(globalThis, "CSS", { configurable: true, value: {} });
    assert.equal(parseTheme({ bg: "#abc" }).vars.bg, "#abc");

    const supports = t.mock.fn((property, value) => property === "color" && value === "#abc");
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports } });
    assert.equal(parseTheme({ bg: " #abc " }).vars.bg, "#abc");
    assert.deepEqual(supports.mock.calls[0].arguments, ["color", "#abc"]);
    assert.throws(() => parseTheme({ bg: "#def" }), { message: "THEME_INVALID_COLOR:bg" });
    assert.equal(supports.mock.callCount(), 2);

    assert.throws(() => parseTheme({ bg: "url(evil)" }), { message: "THEME_INVALID_COLOR:bg" });
    assert.equal(supports.mock.callCount(), 2);
  });
});
