import { describe, expect, it } from "vitest";
import { getTemplate, resolveTemplate, suggestTemplates } from "../src/catalogue.js";

describe("template resolution", () => {
  it("resolves memegen's own short ids", () => {
    expect(resolveTemplate("db")?.name).toBe("Distracted Boyfriend");
  });

  it("resolves the name a format is known by, however it is punctuated", () => {
    expect(resolveTemplate("distracted-boyfriend")?.id).toBe("db");
    expect(resolveTemplate("Change My Mind")?.id).toBe("cmm");
    expect(resolveTemplate("Is this a pigeon?")?.id).toBe("pigeon");
  });

  it("resolves popular names memegen does not use", () => {
    expect(resolveTemplate("two-buttons")?.id).toBe("ds");
    expect(resolveTemplate("expanding-brain")?.id).toBe("gb");
  });

  it("returns nothing for an id outside the catalogue", () => {
    expect(resolveTemplate("totally-made-up-meme")).toBeUndefined();
  });

  it("keeps getTemplate strict, so resources only serve canonical ids", () => {
    expect(getTemplate("distracted-boyfriend")).toBeUndefined();
  });

  it("suggests near misses for an unresolvable id", () => {
    expect(suggestTemplates("crying-brain").map((t) => t.id)).toContain("gb");
    expect(suggestTemplates("zzz")).toEqual([]);
  });
});
