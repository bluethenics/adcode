/**
 * The starting shape of a file.
 *
 * A new `.html` file that opens empty is a small cruelty. Everybody who has written one
 * knows there is a `<!doctype>`, a `<head>`, a `<meta charset>` and a `<body>` that go at
 * the top, nobody remembers the exact order, and the answer is a web search that lands on a
 * page from 2011. VS Code solved this with Emmet's `!` and it is one of the most-used
 * things in it.
 *
 * So ADCode writes the skeleton. A file created from the tree opens with the boilerplate its
 * language always begins with, and the cursor already sitting where the work starts.
 *
 * **Three rules held the templates to a size.**
 *
 * 1. *Only what is always true.* Nothing opinionated, no framework, no author's favourite
 *    structure. A C file begins with `#include <stdio.h>` and a `main` that returns 0
 *    because every C file does; it does not begin with a logging macro somebody likes.
 * 2. *It must run.* Every template below is a complete, working program or document of its
 *    kind. A skeleton that does not compile has taught the reader nothing and cost them a
 *    debugging session on their first minute in the file.
 * 3. *The cursor lands where you would have put it.* `$0` marks that spot and is stripped;
 *    without it the reader starts at line 1 column 1 and has to navigate through the part
 *    they did not write.
 */

export interface Scaffold {
  /** For the command's status line: "an HTML5 page". */
  readonly label: string;
  readonly text: string;
  /** Where the caret goes, as a zero-based offset into `text`. */
  readonly cursor: number;
}

/** `$0` marks the caret. Exactly one, and it is removed from the text. */
function build(label: string, template: string): Scaffold {
  const cursor = template.indexOf("$0");

  return {
    label,
    text: cursor === -1 ? template : template.replace("$0", ""),
    cursor: cursor === -1 ? 0 : cursor,
  };
}

/**
 * `{name}` is the filename without its extension.
 *
 * A Java class must be named after its file or it does not compile, and a Python module
 * that greets the reader by its own name is doing the one thing a template can do to look
 * like it was written for this file rather than pasted into it.
 */
const TEMPLATES: Readonly<Record<string, { readonly label: string; readonly text: string }>> = {
  html: {
    label: "an HTML5 page",
    text: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{name}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    $0
    <script src="script.js"></script>
  </body>
</html>
`,
  },

  css: {
    label: "a stylesheet",
    text: `/* {name} */

:root {
  --text: #1c1c1e;
  --background: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--text);
  background: var(--background);
}

$0
`,
  },

  javascript: {
    label: "a JavaScript module",
    text: `/**
 * {name}
 */

export function {ident}() {
  $0
}
`,
  },

  typescript: {
    label: "a TypeScript module",
    text: `/**
 * {name}
 */

export function {ident}(): void {
  $0
}
`,
  },

  python: {
    label: "a Python script",
    text: `"""{name}."""


def main() -> None:
    $0


if __name__ == "__main__":
    main()
`,
  },

  c: {
    label: "a C program",
    text: `#include <stdio.h>

int main(void) {
    $0
    return 0;
}
`,
  },

  cpp: {
    label: "a C++ program",
    text: `#include <iostream>

int main() {
    $0
    return 0;
}
`,
  },

  java: {
    label: "a Java class",
    text: `public class {ident} {
    public static void main(String[] args) {
        $0
    }
}
`,
  },

  csharp: {
    label: "a C# program",
    text: `using System;

class {ident}
{
    static void Main()
    {
        $0
    }
}
`,
  },

  go: {
    label: "a Go program",
    text: `package main

import "fmt"

func main() {
	$0
}
`,
  },

  rust: {
    label: "a Rust program",
    text: `fn main() {
    $0
}
`,
  },

  php: {
    label: "a PHP file",
    text: `<?php

declare(strict_types=1);

$0
`,
  },

  ruby: {
    label: "a Ruby script",
    text: `# frozen_string_literal: true

def main
  $0
end

main if __FILE__ == $PROGRAM_NAME
`,
  },

  shell: {
    label: "a shell script",
    text: `#!/usr/bin/env bash
# {name}

# Stop on the first error, on an unset variable, and on a failure anywhere in a pipe.
# Without these three a script carries on cheerfully after the step that broke.
set -euo pipefail

$0
`,
  },

  powershell: {
    label: "a PowerShell script",
    text: `<#
.SYNOPSIS
    {name}
#>

$ErrorActionPreference = 'Stop'

$0
`,
  },

  json: {
    label: "a JSON document",
    text: `{
  $0
}
`,
  },

  markdown: {
    label: "a Markdown document",
    text: `# {name}

$0
`,
  },

  lua: {
    label: "a Lua script",
    text: `-- {name}

local function main()
    $0
end

main()
`,
  },

  swift: {
    label: "a Swift program",
    text: `import Foundation

$0
`,
  },

  kotlin: {
    label: "a Kotlin program",
    text: `fun main() {
    $0
}
`,
  },

  dart: {
    label: "a Dart program",
    text: `void main() {
  $0
}
`,
  },

  r: {
    label: "an R script",
    text: `# {name}

main <- function() {
  $0
}

main()
`,
  },

  perl: {
    label: "a Perl script",
    text: `#!/usr/bin/env perl
use strict;
use warnings;

$0
`,
  },
};

/**
 * A safe identifier built from a filename.
 *
 * `my-component.ts` cannot produce `function my-component()`, which is a syntax error, and
 * a template that does not compile fails rule two above. Dashes and dots become
 * underscores, and a name that starts with a digit gets a prefix, because no language
 * allows one.
 */
export function identifierFrom(filename: string): string {
  const base = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]*$/, "");
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, "_");

  if (cleaned.length === 0) return "main";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** The bare filename, for templates that put it in a comment or a title. */
function displayName(filename: string): string {
  return (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]*$/, "");
}

/**
 * The starting shape for a new file, or `null` when there is no honest one.
 *
 * `null` for every language not in the table, and the caller leaves the file empty. An
 * invented skeleton for a language nobody wrote one for would be a guess dropped into the
 * user's file, which is a worse outcome than an empty buffer by some distance.
 */
export function scaffoldFor(languageId: string, filename: string): Scaffold | null {
  const template = TEMPLATES[languageId];
  if (template === undefined) return null;

  /*
   * Two substitutions, and the difference between them matters.
   *
   * `{name}` goes in prose - a title, a comment - and is the filename as written.
   * `{ident}` goes where the language needs a legal name, and `my-component.ts` must not
   * become `export function my-component()`, which does not parse. A single substitution
   * would have to choose, and either choice is wrong half the time.
   */
  const text = template.text
    .split("{ident}")
    .join(identifierFrom(filename))
    .split("{name}")
    .join(displayName(filename));

  return build(template.label, text);
}

export function languagesWithScaffolds(): string[] {
  return Object.keys(TEMPLATES).sort();
}
