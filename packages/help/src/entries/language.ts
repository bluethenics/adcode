/**
 * Language: the parts that understand the language you are writing.
 */
import type { HelpEntry } from "../types.ts";

export const LANGUAGE_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.language.lspClient",
    title: "Language server intelligence",
    plain:
      "A helper program that really understands the language you are writing, so ADCode can offer accurate suggestions, spot mistakes, and know where things are defined.",
    why: "Without one, an editor is guessing from the shape of the words. With one, it knows.",
    how: "On by default. It uses language servers already installed on your machine - ADCode does not bundle them. If one is running for the file you are in, you will see richer suggestions and more precise errors.",
    group: "language",
    settingIds: ["adcode.language.lspClient"],
    related: ["adcode.language.customServers", "adcode.navigation.goToDefinition"],
  },
  {
    id: "adcode.language.customServers",
    title: "Additional language servers",
    plain:
      "Tell ADCode how to start the helper program for a language it does not know about yet.",
    why: "This is what replaces having to install an extension for every language. If your language has a language server, you can use it here.",
    how: "One per line, written as 'language: command'. For example 'zig: zls' or 'elm: elm-language-server --stdio'. It takes effect when you click away from the box.",
    group: "language",
    settingIds: ["adcode.language.customServers"],
    related: ["adcode.language.lspClient"],
  },
  {
    id: "adcode.language.dapClient",
    title: "Debug adapter client",
    plain:
      "Stop your program in the middle of running it, look at what every value actually is, and step through it one line at a time.",
    why: "Adding print statements to work out what a program is doing is guessing with extra steps. A debugger just shows you.",
    how: "On by default for JavaScript, TypeScript, and Python. Click in the margin left of a line number to set a stop point - a red dot - then press F5 to run. When it stops, the panel shows every value in scope; F10 goes to the next line, F11 steps inside a function, and F5 carries on. A language ADCode has no debugger for will say so rather than offering a button that does nothing.",
    group: "language",
    settingIds: ["adcode.language.dapClient"],
    shortcut: "F5",
    related: ["adcode.language.lspClient", "adcode.editing.inlineErrorLens"],
  },
  {
    id: "adcode.language.treeSitterHighlighting",
    title: "Tree-sitter highlighting",
    plain:
      "Colours the code by properly reading it, rather than by pattern-matching the words - so the colours are right even in tricky code.",
    why: "Simple colouring gets confused by things like a keyword inside a string, or nested templates. Real parsing does not get confused.",
    how: "On by default. It loads the grammar for a language the first time you open a file in it. If a grammar cannot be loaded, colouring quietly falls back to the simpler method rather than turning off.",
    group: "language",
    settingIds: ["adcode.language.treeSitterHighlighting"],
    related: ["adcode.editing.bracketPairColorization", "adcode.navigation.outline"],
  },
];
