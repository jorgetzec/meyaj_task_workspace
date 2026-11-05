import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProjectLabel,
  projectQuery,
  matchingProjects,
} from "../src/utils/projects.ts";

function project(id, label, sortOrder) {
  return { id, label, sortOrder, colorAccent: null, panelId: "panel-1" };
}

function ids(projects) {
  return projects.map((item) => item.id);
}

describe("normalizeProjectLabel", () => {
  for (const [input, expected] of [
    ["  Mi   Proyecto  ", "mi proyecto"],
    ["\tMI\nPROYECTO\t", "mi proyecto"],
    ["ÁRBOL ÑANDÚ", "arbol nandu"],
    ["Cafe\u0301", "cafe"],
    ["  Investigación\u00a0  MÉXICO ", "investigacion mexico"],
    ["", ""],
    [" \t ", ""],
  ]) {
    it(`normalizes ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeProjectLabel(input), expected);
    });
  }
});

describe("projectQuery", () => {
  for (const [input, expected] of [
    ["#Proyecto", "Proyecto"],
    ["# Proyecto", "Proyecto"],
    ["##Proyecto", "Proyecto"],
    ["## Proyecto", "Proyecto"],
    ["  ##   Investigación MÉXICO  ", "Investigación MÉXICO"],
    ["\t# Café con leche ", "Café con leche"],
    ["#", ""],
    ["##", ""],
    ["#   ", ""],
    ["  ##  ", ""],
  ]) {
    it(`extracts a command from ${JSON.stringify(input)}`, () => {
      assert.equal(projectQuery(input), expected);
    });
  }

  for (const input of [
    "### Proyecto", "###Proyecto", "#### Proyecto", "  ### Proyecto",
    "Terminar tarea #Proyecto", "Terminar tarea ##Proyecto",
    "- [ ] Revisar #Proyecto", "Texto antes de # Proyecto",
    "Sin comando", "", "   ", "# Uno\nDos", "## Uno\r\nDos",
  ]) {
    it(`does not treat ${JSON.stringify(input)} as a project command`, () => {
      assert.equal(projectQuery(input), null);
    });
  }
});

describe("matchingProjects", () => {
  it("ranks exact matches before prefixes before substrings, then by sortOrder", () => {
    const projects = [
      project("substring-late", "Gran árbol", -10),
      project("prefix-late", "Árbol rojo", 20),
      project("exact-late", "ÁRBOL", 200),
      project("unrelated", "Bosque", -200),
      project("substring-early", "Mi árbol azul", -20),
      project("exact-early", "Arbol", 100),
      project("prefix-early", "Arbol verde", 10),
    ];

    assert.deepEqual(ids(matchingProjects(projects, "arbol")), [
      "exact-early", "exact-late", "prefix-early", "prefix-late",
      "substring-early", "substring-late",
    ]);
  });

  it("matches labels and queries regardless of accents, case, and repeated spaces", () => {
    const projects = [
      project("exact", "  Investigación   MÉXICO ", 20),
      project("prefix", "INVESTIGACIÓN México norte", 10),
      project("substring", "Plan de investigacion mexico", 0),
      project("unrelated", "Investigación Perú", -10),
    ];
    const expected = ["exact", "prefix", "substring"];
    assert.deepEqual(ids(matchingProjects(projects, " INVESTIGACION  méxico ")), expected);
    assert.deepEqual(ids(matchingProjects(projects, "investigacio\u0301n me\u0301xico")), expected);
  });

  it("matches composed and decomposed accents equivalently", () => {
    const projects = [project("cafe", "Cafe\u0301", 0)];
    assert.deepEqual(ids(matchingProjects(projects, "CAFÉ")), ["cafe"]);
  });

  it("returns an empty array when there are no matches", () => {
    const projects = [project("one", "Árbol", 0), project("two", "Bosque", 1)];
    assert.deepEqual(matchingProjects(projects, "océano"), []);
  });

  it("returns an empty array for an empty project list", () => {
    assert.deepEqual(matchingProjects([], "arbol"), []);
    assert.deepEqual(matchingProjects([], ""), []);
  });

  it("returns every project ordered by sortOrder for an empty or whitespace query", () => {
    const projects = [project("late", "Bosque", 5), project("early", "Árbol", 1)];
    assert.deepEqual(ids(matchingProjects(projects, "")), ["early", "late"]);
    assert.deepEqual(ids(matchingProjects(projects, " \t ")), ["early", "late"]);
  });

  it("preserves input order when rank and sortOrder tie", () => {
    const projects = [project("first", "Arbol", 1), project("second", "ÁRBOL", 1)];
    assert.deepEqual(ids(matchingProjects(projects, "árbol")), ["first", "second"]);
  });

  it("does not mutate the input array or its project objects", () => {
    const late = Object.freeze(project("late", "Arbol", 10));
    const early = Object.freeze(project("early", "Árbol", 1));
    const projects = Object.freeze([late, early]);
    const result = matchingProjects(projects, "arbol");

    assert.deepEqual(ids(result), ["early", "late"]);
    assert.deepEqual(ids(projects), ["late", "early"]);
    assert.notStrictEqual(result, projects);
    assert.strictEqual(result[0], early);
    assert.strictEqual(result[1], late);
  });
});
