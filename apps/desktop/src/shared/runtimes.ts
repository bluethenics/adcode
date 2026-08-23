/**
 * The programs a Run button needs, and what to say when one is not there.
 *
 * Pressing Run on a Python file with no Python installed produces, in every editor, a
 * terminal line that says `python: command not found` or - on Windows, which is worse -
 * opens the Microsoft Store. Neither tells a beginner what happened or what to do, and the
 * beginner is precisely who pressed the button.
 *
 * So the run path asks first. If the program is missing, ADCode says which program, what
 * installs it on *this* platform, and offers to open the page. That is a two-minute fix
 * instead of a dead end, and it is the same reasoning as `@adcode/lsp`'s `installHint`:
 * "this editor does not support Python" and "this editor needs one more install" are very
 * different conclusions for a user to reach, and only one of them is true.
 *
 * **Shared between main and the renderer, on purpose.** The renderer works out which
 * program a command needs; the main process resolves it against PATH and opens the page.
 * The renderer never sends a URL across the bridge - it names a runtime by id and the main
 * process looks the address up in this same table. Accepting a URL from a renderer would
 * hand a compromised one `shell.openExternal(anything)`, which is the sandbox escape that
 * `preview:open-external` is already written to refuse.
 */

export interface Runtime {
  /** Stable id, and what crosses the bridge. Never a URL. */
  readonly id: string;
  /** What a person calls it: "Python", "the Java Development Kit". */
  readonly label: string;
  /** Executable names that mean this runtime, as they appear on a command line. */
  readonly commands: readonly string[];
  /** The official download page. HTTPS, and checked at the point of use. */
  readonly url: string;
  /** One line the user can paste. Per platform, because the answer genuinely differs. */
  readonly install: {
    readonly win32?: string;
    readonly darwin?: string;
    readonly linux?: string;
  };
  /**
   * Windows sometimes needs a different page entirely.
   *
   * `gcc` is the clearest case: on Linux it is a package, on macOS it comes with the
   * command line tools, and on Windows there is no such thing as "installing GCC" - you
   * install MSYS2 and get it from there. Sending a Windows user to gcc.gnu.org is sending
   * them to build a compiler from source.
   */
  readonly windowsUrl?: string;
}

export const RUNTIMES: readonly Runtime[] = [
  {
    id: "python",
    label: "Python",
    commands: ["python", "python3", "py"],
    url: "https://www.python.org/downloads/",
    install: {
      win32: "winget install Python.Python.3.13",
      darwin: "brew install python",
      linux: "sudo apt install python3",
    },
  },
  {
    id: "node",
    label: "Node.js",
    commands: ["node", "npm", "npx"],
    url: "https://nodejs.org/en/download",
    install: {
      win32: "winget install OpenJS.NodeJS.LTS",
      darwin: "brew install node",
      linux: "sudo apt install nodejs npm",
    },
  },
  {
    id: "go",
    label: "Go",
    commands: ["go"],
    url: "https://go.dev/dl/",
    install: {
      win32: "winget install GoLang.Go",
      darwin: "brew install go",
      linux: "sudo apt install golang",
    },
  },
  {
    id: "rust",
    label: "Rust",
    commands: ["rustc", "cargo"],
    url: "https://rustup.rs",
    install: {
      win32: "winget install Rustlang.Rustup",
      darwin: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
      linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
    },
  },
  {
    id: "java",
    label: "Java",
    commands: ["java", "javac"],
    url: "https://adoptium.net/temurin/releases/",
    install: {
      win32: "winget install EclipseAdoptium.Temurin.21.JDK",
      darwin: "brew install openjdk",
      linux: "sudo apt install default-jdk",
    },
  },
  {
    id: "gcc",
    label: "GCC, the C compiler",
    commands: ["gcc", "cc"],
    url: "https://gcc.gnu.org/install/",
    windowsUrl: "https://www.msys2.org/",
    install: {
      win32: "winget install MSYS2.MSYS2   (then: pacman -S mingw-w64-ucrt-x86_64-gcc)",
      darwin: "xcode-select --install",
      linux: "sudo apt install build-essential",
    },
  },
  {
    id: "gpp",
    label: "g++, the C++ compiler",
    commands: ["g++", "c++"],
    url: "https://gcc.gnu.org/install/",
    windowsUrl: "https://www.msys2.org/",
    install: {
      win32: "winget install MSYS2.MSYS2   (then: pacman -S mingw-w64-ucrt-x86_64-gcc)",
      darwin: "xcode-select --install",
      linux: "sudo apt install build-essential",
    },
  },
  {
    id: "clang",
    label: "Clang",
    commands: ["clang", "clang++"],
    url: "https://releases.llvm.org/",
    install: {
      win32: "winget install LLVM.LLVM",
      darwin: "xcode-select --install",
      linux: "sudo apt install clang",
    },
  },
  {
    id: "dotnet",
    label: "the .NET SDK",
    commands: ["dotnet"],
    url: "https://dotnet.microsoft.com/download",
    install: {
      win32: "winget install Microsoft.DotNet.SDK.9",
      darwin: "brew install dotnet-sdk",
      linux: "sudo apt install dotnet-sdk-9.0",
    },
  },
  {
    id: "ruby",
    label: "Ruby",
    commands: ["ruby", "gem", "irb"],
    url: "https://www.ruby-lang.org/en/downloads/",
    install: {
      win32: "winget install RubyInstallerTeam.Ruby.3.3",
      darwin: "brew install ruby",
      linux: "sudo apt install ruby-full",
    },
  },
  {
    id: "php",
    label: "PHP",
    commands: ["php"],
    url: "https://www.php.net/downloads",
    install: {
      win32: "winget install PHP.PHP.8.3",
      darwin: "brew install php",
      linux: "sudo apt install php-cli",
    },
  },
  {
    id: "lua",
    label: "Lua",
    commands: ["lua"],
    url: "https://www.lua.org/download.html",
    install: { win32: "winget install DEVCOM.Lua", darwin: "brew install lua", linux: "sudo apt install lua5.4" },
  },
  {
    id: "perl",
    label: "Perl",
    commands: ["perl"],
    url: "https://www.perl.org/get.html",
    install: {
      win32: "winget install StrawberryPerl.StrawberryPerl",
      darwin: "brew install perl",
      linux: "sudo apt install perl",
    },
  },
  {
    id: "r",
    label: "R",
    commands: ["Rscript", "R"],
    url: "https://cran.r-project.org/",
    install: { win32: "winget install RProject.R", darwin: "brew install r", linux: "sudo apt install r-base" },
  },
  {
    id: "swift",
    label: "Swift",
    commands: ["swift", "swiftc"],
    url: "https://www.swift.org/install/",
    install: { win32: "winget install Swift.Toolchain", darwin: "xcode-select --install", linux: "" },
  },
  {
    id: "dart",
    label: "Dart",
    commands: ["dart"],
    url: "https://dart.dev/get-dart",
    install: { win32: "winget install Google.DartSDK", darwin: "brew install dart-sdk", linux: "" },
  },
  {
    id: "julia",
    label: "Julia",
    commands: ["julia"],
    url: "https://julialang.org/downloads/",
    install: { win32: "winget install Julialang.Julia", darwin: "brew install julia", linux: "curl -fsSL https://install.julialang.org | sh" },
  },
  {
    id: "elixir",
    label: "Elixir",
    commands: ["elixir", "iex", "mix"],
    url: "https://elixir-lang.org/install.html",
    install: { win32: "winget install Elixir.Elixir", darwin: "brew install elixir", linux: "sudo apt install elixir" },
  },
  {
    id: "scala",
    label: "Scala",
    commands: ["scala", "scalac"],
    url: "https://www.scala-lang.org/download/",
    install: { win32: "winget install Scala.Scala", darwin: "brew install scala", linux: "" },
  },
  {
    id: "clojure",
    label: "Clojure",
    commands: ["clojure", "clj"],
    url: "https://clojure.org/guides/install_clojure",
    install: { darwin: "brew install clojure", linux: "sudo apt install clojure" },
  },
  {
    id: "kotlin",
    label: "the Kotlin compiler",
    commands: ["kotlinc", "kotlin"],
    url: "https://kotlinlang.org/docs/command-line.html",
    install: { win32: "choco install kotlinc", darwin: "brew install kotlin", linux: "sdk install kotlin" },
  },
  {
    id: "coffeescript",
    label: "CoffeeScript",
    commands: ["coffee"],
    url: "https://coffeescript.org/#installation",
    install: { win32: "npm install -g coffeescript", darwin: "npm install -g coffeescript", linux: "npm install -g coffeescript" },
  },
  {
    id: "bash",
    label: "Bash",
    commands: ["bash", "sh"],
    url: "https://www.gnu.org/software/bash/",
    // On Windows the honest answer is Git for Windows: it is how ninety-nine people in a
    // hundred end up with a working bash, and telling them to build GNU Bash is not help.
    windowsUrl: "https://gitforwindows.org/",
    install: { win32: "winget install Git.Git", darwin: "", linux: "sudo apt install bash" },
  },
  {
    id: "powershell",
    label: "PowerShell 7",
    commands: ["pwsh"],
    url: "https://learn.microsoft.com/powershell/scripting/install/installing-powershell",
    install: {
      win32: "winget install Microsoft.PowerShell",
      darwin: "brew install powershell/tap/powershell",
      linux: "sudo apt install powershell",
    },
  },
];

/**
 * Which runtime a command line needs, by its first word.
 *
 * Only the first word of the first segment. `g++ a.cpp && ./a` needs a C++ compiler; if it
 * is there, the second half is the program the user just built, and asking whether `./a` is
 * installed would be asking whether their own code exists.
 */
export function commandWordOf(commandLine: string): string | null {
  const first = commandLine.split(/&&|\|\||;|\|/)[0]?.trim() ?? "";
  if (first.length === 0) return null;

  // A quoted first token is a path to a program, not a name on PATH. Nothing in the recipe
  // table produces one, and guessing at it would mean checking the user's own binary.
  if (first.startsWith('"') || first.startsWith("'")) return null;

  const word = first.split(/\s+/)[0] ?? "";
  return word.length === 0 ? null : word;
}

export function runtimeFor(command: string): Runtime | null {
  const word = command.toLowerCase();
  return RUNTIMES.find((runtime) => runtime.commands.some((name) => name.toLowerCase() === word)) ?? null;
}

export function runtimeById(id: string): Runtime | null {
  return RUNTIMES.find((runtime) => runtime.id === id) ?? null;
}

/** The page to send this platform to. */
export function downloadUrlFor(runtime: Runtime, platform: string): string {
  return platform === "win32" && runtime.windowsUrl !== undefined ? runtime.windowsUrl : runtime.url;
}

/** The one-line install command for this platform, or null when there is not a good one. */
export function installCommandFor(runtime: Runtime, platform: string): string | null {
  const key = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
  const command = runtime.install[key];

  return command === undefined || command.length === 0 ? null : command;
}
