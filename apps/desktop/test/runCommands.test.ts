import { describe, it, expect } from "vitest";
import { quotePath, runActionFor, runnableLanguages } from "../src/renderer/run/runCommands.ts";

const NO_FILES: string[] = [];
const WEB = ["index.html", "style.css", "script.js"];

describe("quotePath", () => {
  it("quotes, so a path with a space in it survives the shell", () => {
    expect(quotePath("C:/my project/a.py")).toBe('"C:/my project/a.py"');
  });

  it("refuses a path that could end the quote and start a second command", () => {
    // A filename containing a double quote is not worth supporting, and building a command
    // line out of one would hand the shell something the user never typed.
    expect(quotePath('a".py')).toBeNull();
    expect(quotePath("a\npy")).toBeNull();
    expect(quotePath("")).toBeNull();
  });
});

describe("runActionFor - web", () => {
  it("offers Go Live on an HTML file", () => {
    expect(runActionFor("html", "index.html", WEB, "linux")).toEqual({
      mode: "live",
      label: "Go Live",
      command: "",
    });
  });

  it("offers Go Live on a stylesheet that belongs to a page", () => {
    expect(runActionFor("css", "style.css", WEB, "linux")?.mode).toBe("live");
  });

  it("runs a standalone script rather than previewing it", () => {
    // The one guess in the module, and the one that decides whether the button previews or
    // executes: a `script.js` with no page anywhere is a program, not part of a website.
    const action = runActionFor("javascript", "tool.js", ["tool.js"], "linux");

    expect(action?.mode).toBe("run");
    expect(action?.command).toBe('node "tool.js"');
  });

  it("previews the same script when there is a page beside it", () => {
    expect(runActionFor("javascript", "script.js", WEB, "linux")?.mode).toBe("live");
  });

  it("offers Go Live on HTML even with no index.html at the root", () => {
    // The file in front of you *is* a page. Requiring an `index.html` too would refuse to
    // preview `about.html` in a folder that has no index.
    expect(runActionFor("html", "about.html", ["about.html"], "linux")?.mode).toBe("live");
  });
});

describe("runActionFor - running a file", () => {
  it("names the language in the button, so the button says what it does", () => {
    expect(runActionFor("python", "main.py", NO_FILES, "linux")?.label).toBe("Run Python");
    expect(runActionFor("go", "main.go", NO_FILES, "linux")?.label).toBe("Run Go");
    expect(runActionFor("rust", "main.rs", NO_FILES, "linux")?.label).toBe("Run Rust");
  });

  it("uses python3 on POSIX and python on Windows", () => {
    // `python` on a Linux box is either missing or Python 2, and both failures look like
    // the user's file is broken.
    expect(runActionFor("python", "a.py", NO_FILES, "linux")?.command).toBe('python3 "a.py"');
    expect(runActionFor("python", "a.py", NO_FILES, "win32")?.command).toBe('python "a.py"');
  });

  it("runs TypeScript through node directly", () => {
    // Node 24 executes TypeScript, and this package's `engines` already requires it - so
    // there is no transpile step to explain to someone on their first day.
    expect(runActionFor("typescript", "a.ts", NO_FILES, "linux")?.command).toBe('node "a.ts"');
  });

  it("compiles and then runs, pointing at the binary the way each platform needs", () => {
    // Without the `./`, a POSIX shell searches PATH and reports "command not found" for a
    // file sitting right there.
    expect(runActionFor("c", "hello.c", NO_FILES, "linux")?.command).toBe(
      'gcc "hello.c" -o "hello" && "./hello"',
    );
    expect(runActionFor("c", "hello.c", NO_FILES, "win32")?.command).toBe(
      'gcc "hello.c" -o "hello" && "hello.exe"',
    );
  });

  it("quotes a stem it appends to, rather than producing \"x\".jar", () => {
    const command = runActionFor("kotlin", "App.kt", NO_FILES, "linux")?.command ?? "";

    expect(command).toContain('-d "App.jar"');
    expect(command).toContain('java -jar "App.jar"');
    expect(command).not.toContain('"App".jar');
  });

  it("prefers the project manifest over compiling a loose file", () => {
    expect(runActionFor("rust", "src/main.rs", ["Cargo.toml"], "linux")?.command).toBe("cargo run");
    expect(runActionFor("rust", "scratch.rs", NO_FILES, "linux")?.command).toContain("rustc");
  });

  it("matches a wildcard manifest", () => {
    expect(runActionFor("csharp", "Program.cs", ["App.csproj"], "linux")?.command).toBe("dotnet run");
  });

  it("hides rather than offering a command certain to fail", () => {
    // A loose `.cs` file has nothing `dotnet` can be pointed at. A button that always
    // errors teaches the user to stop pressing it.
    expect(runActionFor("csharp", "Program.cs", NO_FILES, "linux")).toBeNull();
  });

  it("keeps the path it was given, spaces and all", () => {
    expect(runActionFor("python", "my scripts/a.py", NO_FILES, "linux")?.command).toBe(
      'python3 "my scripts/a.py"',
    );
  });

  it("takes the stem from the filename, not from the whole path", () => {
    expect(runActionFor("c", "src/deep/hello.c", NO_FILES, "win32")?.command).toContain(
      '-o "hello"',
    );
  });

  it("refuses a filename that could break out of its quotes", () => {
    expect(runActionFor("python", 'a".py', NO_FILES, "linux")).toBeNull();
  });

  it("offers nothing for a language with no way to run one file", () => {
    expect(runActionFor("json", "package.json", NO_FILES, "linux")).toBeNull();
    expect(runActionFor("markdown", "README.md", NO_FILES, "linux")).toBeNull();
    expect(runActionFor("brainfuck", "a.bf", NO_FILES, "linux")).toBeNull();
  });
});

describe("the recipe table", () => {
  it("covers the languages a learner is most likely to be set", () => {
    const covered = new Set(runnableLanguages());

    for (const language of ["python", "javascript", "typescript", "java", "c", "cpp", "go", "rust", "ruby", "php"]) {
      expect(covered.has(language), `${language} is not runnable`).toBe(true);
    }
  });

  it("offers breadth comparable to what people expect from VS Code", () => {
    expect(runnableLanguages().length).toBeGreaterThanOrEqual(20);
  });

  it("produces a command with no placeholder left in it, for every language", () => {
    // A `{stem}` that survived into the command line is a shell error the user cannot
    // possibly diagnose.
    for (const language of runnableLanguages()) {
      const action = runActionFor(language, `sample.${language}`, ["Cargo.toml", "App.csproj"], "win32");
      if (action === null) continue;

      expect(action.command, `${language} left a placeholder`).not.toMatch(/\{(file|stem|exe)\}/);
      expect(action.command.length, `${language} produced no command`).toBeGreaterThan(0);
    }
  });

  it("balances its quotes in every generated command", () => {
    for (const language of runnableLanguages()) {
      for (const platform of ["win32", "linux"]) {
        const action = runActionFor(language, "some dir/sample.txt", NO_FILES, platform);
        if (action === null || action.mode !== "run") continue;

        const quotes = (action.command.match(/"/g) ?? []).length;
        expect(quotes % 2, `${language} on ${platform}: ${action.command}`).toBe(0);
      }
    }
  });
});
