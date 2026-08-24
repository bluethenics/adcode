import { describe, expect, it } from "vitest";
import {
  definedClasses,
  missingClasses,
  rulesForElement,
  styleRules,
  unusedSelectors,
} from "@adcode/structure";

const CSS = `
/* a comment with a { brace } in it */
.card { color: red; }
.card__title { font-weight: 600; }
#hero { margin: 0; }

@media (min-width: 40rem) {
  .card { padding: 2rem; }
}

a:hover { color: blue; }
`;

describe("styleRules", () => {
  it("finds every selector with its line", () => {
    const rules = styleRules(CSS);
    expect(rules.map((rule) => rule.selector)).toEqual([
      ".card",
      ".card__title",
      "#hero",
      ".card",
      "a:hover",
    ]);
  });

  it("skips the at-rule but keeps what is inside it", () => {
    // Half a responsive stylesheet lives inside @media; dropping those rules would make
    // every one of them look unused.
    const inside = styleRules(CSS).filter((rule) => rule.selector === ".card");
    expect(inside).toHaveLength(2);
  });

  it("is not confused by a brace in a comment", () => {
    expect(styleRules(CSS).some((rule) => rule.selector.includes("comment"))).toBe(false);
  });

  it("reports usable line numbers", () => {
    const first = styleRules(CSS).find((rule) => rule.selector === ".card__title");
    expect(first?.line).toBe(4);
  });
});

describe("rulesForElement", () => {
  it("finds the rules that style an element", () => {
    const element = { tag: "div", id: null, classes: ["card"], line: 1, column: 1 };
    expect(rulesForElement(CSS, element).map((rule) => rule.selector)).toEqual([".card", ".card"]);
  });

  it("matches an id", () => {
    const element = { tag: "section", id: "hero", classes: [], line: 1, column: 1 };
    expect(rulesForElement(CSS, element).map((rule) => rule.selector)).toEqual(["#hero"]);
  });

  it("finds nothing for an element nothing styles", () => {
    const element = { tag: "span", id: null, classes: ["nope"], line: 1, column: 1 };
    expect(rulesForElement(CSS, element)).toEqual([]);
  });
});

describe("unusedSelectors", () => {
  it("leaves alone the selectors the markup does use", () => {
    const markup = ['<div class="card"><h2 class="card__title">x</h2></div>'];
    const unused = unusedSelectors(CSS, markup).map((rule) => rule.selector);

    expect(unused).not.toContain(".card");
    expect(unused).not.toContain(".card__title");
    // `#hero` really is unused by this markup, and saying so is the whole feature.
    expect(unused).toContain("#hero");
  });

  it("finds one that is genuinely unused", () => {
    const markup = ['<div class="card">x</div>'];
    const unused = unusedSelectors(CSS, markup).map((rule) => rule.selector);
    expect(unused).toContain(".card__title");
  });

  /*
   * Conservative on purpose. A bare tag selector, a pseudo-class or an attribute selector
   * cannot be judged fairly from names alone, and reporting them is how this feature
   * becomes noise somebody switches off.
   */
  it("never reports a tag-only selector", () => {
    const unused = unusedSelectors("body { margin: 0; }", ['<div class="x">y</div>']);
    expect(unused).toEqual([]);
  });

  it("never reports a pseudo-class", () => {
    expect(unusedSelectors(CSS, ['<div class="card"></div>']).map((r) => r.selector)).not.toContain(
      "a:hover",
    );
  });

  it("says nothing when there is no markup to compare against", () => {
    expect(unusedSelectors(CSS, [])).toEqual([]);
  });
});

describe("missingClasses", () => {
  it("finds a class no stylesheet defines", () => {
    const found = missingClasses('<div class="card typo-here">x</div>', [CSS]);
    expect(found.map((one) => one.name)).toEqual(["typo-here"]);
  });

  it("reports where it is", () => {
    const markup = ["<div>", '<span class="ghost">x</span>', "</div>"].join("\n");
    expect(missingClasses(markup, [CSS])[0]?.line).toBe(2);
  });

  it("reports each name once", () => {
    const markup = '<a class="ghost"></a><b class="ghost"></b>';
    expect(missingClasses(markup, [CSS])).toHaveLength(1);
  });

  /* With no stylesheets, every class is "missing" - true, and completely useless. */
  it("says nothing when there are no stylesheets", () => {
    expect(missingClasses('<div class="anything">x</div>', [])).toEqual([]);
  });

  it("reads a JSX className", () => {
    expect(missingClasses('<div className="ghost">x</div>', [CSS]).map((o) => o.name)).toEqual([
      "ghost",
    ]);
  });

  it("keeps the literal part of a template class and drops the expression", () => {
    // `card` is certainly there; whatever `${size}` becomes is not knowable from here.
    const found = missingClasses("<div className={`card ${size}`}>x</div>", [CSS]);
    expect(found).toEqual([]);
  });

  it("ignores a fully dynamic class", () => {
    expect(missingClasses("<div className={styles.card}>x</div>", [CSS])).toEqual([]);
  });
});

describe("definedClasses", () => {
  it("lists what a stylesheet defines, once each", () => {
    const names = definedClasses(CSS)
      .filter((target) => target.kind === "class")
      .map((target) => target.name);
    expect(names).toEqual(["card", "card__title"]);
  });
});
