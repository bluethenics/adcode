import { describe, expect, it } from "vitest";
import { knownLanguageIds, languageForFilename } from "../src/renderer/editor/languageIds.ts";
import { runnableLanguages } from "../src/renderer/run/runCommands.ts";
import { outlineSupported } from "@adcode/structure";

describe("languageForFilename", () => {
  it("knows the languages this editor is named for", () => {
    expect(languageForFilename("index.html")).toBe("html");
    expect(languageForFilename("styles.css")).toBe("css");
    expect(languageForFilename("app.js")).toBe("javascript");
    expect(languageForFilename("app.ts")).toBe("typescript");
    expect(languageForFilename("main.cpp")).toBe("cpp");
    expect(languageForFilename("main.py")).toBe("python");
  });

  it("reads a path, not only a bare name", () => {
    expect(languageForFilename("C:\\work\\src\\main.rs")).toBe("rust");
    expect(languageForFilename("src/app/page.tsx")).toBe("typescript");
  });

  it("is case insensitive, because Windows is", () => {
    expect(languageForFilename("Main.PY")).toBe("python");
    expect(languageForFilename("README.MD")).toBe("markdown");
  });

  it("takes the longest extension that means something", () => {
    expect(languageForFilename("api.d.ts")).toBe("typescript");
    expect(languageForFilename(".eslintrc.json")).toBe("json");
  });

  it("recognises files whose name is their type", () => {
    expect(languageForFilename("Dockerfile")).toBe("dockerfile");
    expect(languageForFilename("Gemfile")).toBe("ruby");
    expect(languageForFilename("Rakefile")).toBe("ruby");
    expect(languageForFilename(".gitignore")).toBe("ini");
    expect(languageForFilename(".bashrc")).toBe("shell");
  });

  it("follows a named file's suffix", () => {
    expect(languageForFilename("Dockerfile.prod")).toBe("dockerfile");
    expect(languageForFilename(".env.local")).toBe("ini");
  });

  it("lets a real extension beat the name it is attached to", () => {
    // Documentation *about* a Dockerfile is markdown.
    expect(languageForFilename("Dockerfile.md")).toBe("markdown");
  });

  it("does not claim a file it has no entry for", () => {
    expect(languageForFilename("notes.txt")).toBe("plaintext");
    expect(languageForFilename("archive.tar.gz")).toBe("plaintext");
    expect(languageForFilename("LICENSE")).toBe("plaintext");
  });

  it("does not read a dotfile's leading dot as an extension", () => {
    expect(languageForFilename(".unknownrc")).toBe("plaintext");
  });

  it("covers the tier of languages a general editor is judged on", () => {
    const expected: Readonly<Record<string, string>> = {
      "Main.java": "java",
      "Program.cs": "csharp",
      "main.go": "go",
      "lib.rs": "rust",
      "app.rb": "ruby",
      "index.php": "php",
      "build.sh": "shell",
      "deploy.ps1": "powershell",
      "query.sql": "sql",
      "config.yml": "yaml",
      "schema.graphql": "graphql",
      "Token.sol": "solidity",
      "main.swift": "swift",
      "App.kt": "kotlin",
      "main.dart": "dart",
      "core.clj": "clojure",
      "app.ex": "elixir",
      "plot.jl": "julia",
      "script.lua": "lua",
      "analysis.R": "r",
      "main.tf": "hcl",
      "Program.fs": "fsharp",
      "page.vue": "html",
      "card.scss": "scss",
      "list.hbs": "handlebars",
    };

    for (const [filename, language] of Object.entries(expected)) {
      expect(languageForFilename(filename), filename).toBe(language);
    }
  });
});

describe("the three language tables agree", () => {
  /*
   * The tables are separate on purpose - one decides highlighting, one decides the Run
   * button, one decides the Structure view - and separate tables drift. These are the two
   * drifts that are visible to a user as "this editor does not support my language", so
   * they fail here rather than in a bug report.
   */
  it("can run every language it claims a run recipe for", () => {
    const opened = new Set(knownLanguageIds());

    for (const language of runnableLanguages()) {
      // `bat` and the rest all have to be reachable by opening some file, or the recipe is
      // unreachable code.
      expect(opened.has(language), `no file extension opens as ${language}`).toBe(true);
    }
  });

  it("can read the shape of every language it can run", () => {
    for (const language of runnableLanguages()) {
      expect(outlineSupported(language), `no outline grammar for ${language}`).toBe(true);
    }
  });
});
