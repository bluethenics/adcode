/**
 * Colouring code from a real parse tree.
 *
 * Monaco's own tokenizer is regular expressions per language. It is fast and it is wrong
 * exactly where being wrong is most visible: a keyword inside a string, a nested template
 * literal, a generic that looks like a comparison. A parser is not confused by any of those.
 *
 * This runs *over* Monaco's tokenizer rather than instead of it. Semantic tokens are a
 * layer, so a language with no grammar, a grammar that fails to fetch, or a parse that
 * throws all end in the same place: the colouring the editor has always had. That is the
 * whole failure design, and it is why this feature cannot break an editor.
 *
 * Everything with judgement in it - which node type means what, how to encode the result -
 * is `@adcode/highlight`, which is pure and tested. This file loads WebAssembly, walks a
 * tree, and hands the numbers to Monaco.
 */
import type * as monaco from "monaco-editor";
import {
  encodeTokens,
  grammarFileFor,
  isOpaque,
  tokenFor,
  TOKEN_TYPES,
  type Token,
} from "@adcode/highlight";

export interface TreeSitterHighlight {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Where `scripts/grammars.mjs` puts the wasm, and where Vite serves it from. */
const GRAMMARS = "grammars";

/**
 * Past this, parsing on every keystroke stops being free.
 *
 * Monaco's tokenizer is incremental and line-based; this is a whole-file parse. tree-sitter
 * is fast enough that a large file is still milliseconds, but there is a size past which
 * the right answer is to leave a file to the tokenizer that was designed for it.
 */
const MAX_LENGTH = 1_000_000;

/**
 * The slice of web-tree-sitter this file uses.
 *
 * Declared structurally rather than imported as types: the 0.20 package is CommonJS with a
 * single `export =`, and describing the three calls needed is less friction than teasing
 * that shape through the module system for a dynamic import.
 */
interface ParserLike {
  setLanguage(language: unknown): void;
  parse(text: string): { walk: () => TreeCursorLike } | null;
}

interface ParserConstructor {
  new (): ParserLike;
  init(options?: { locateFile?: (file: string) => string }): Promise<void>;
  Language: { load(path: string): Promise<unknown> };
}

let runtime: Promise<ParserConstructor | null> | null = null;

/**
 * Load the WebAssembly runtime once, for the whole window.
 *
 * Deliberately lazy: it is a megabyte of wasm, and an editor opened on a Markdown file
 * should not pay for a parser it will never use.
 */
async function loadRuntime(): Promise<ParserConstructor | null> {
  runtime ??= (async () => {
    try {
      const module = (await import("web-tree-sitter")) as unknown as {
        default?: ParserConstructor;
      };

      // CommonJS `export =` arrives as either the namespace or its default, depending on
      // how the bundler interops it. Both shapes are the same constructor.
      const Parser = module.default ?? (module as unknown as ParserConstructor);

      await Parser.init({ locateFile: (file: string) => `${GRAMMARS}/${file}` });
      return Parser;
    } catch {
      // No runtime means no semantic tokens, which means Monaco's tokenizer - which is what
      // was on screen a moment ago. Nothing to report.
      return null;
    }
  })();

  return runtime;
}

export function installTreeSitterHighlight(
  monacoApi: typeof monaco,
  ): TreeSitterHighlight {
  let enabled = true;

  /** One parser per language, kept: constructing one loads and compiles a grammar. */
  const parsers = new Map<string, Promise<ParserLike | null>>();

  async function parserFor(languageId: string): Promise<ParserLike | null> {
    const file = grammarFileFor(languageId);
    if (file === null) return null;

    const Parser = await loadRuntime();
    if (Parser === null) return null;

    let pending = parsers.get(languageId);
    if (pending === undefined) {
      pending = (async () => {
        try {
          const language = await Parser.Language.load(`${GRAMMARS}/${file}`);
          const parser = new Parser();
          parser.setLanguage(language);
          return parser;
        } catch {
          // A grammar that will not load is remembered as absent, so a broken file is not
          // re-fetched on every keystroke.
          return null;
        }
      })();
      parsers.set(languageId, pending);
    }

    return await pending;
  }

  /**
   * Walk the tree, collecting what to paint.
   *
   * A cursor rather than recursion over `node.children`: the children array allocates a
   * wrapper object per node, and a large file has hundreds of thousands of them. The cursor
   * walks the same tree without building any of it.
   */
  function collect(rootCursor: TreeCursorLike, languageId: string): Token[] {
    const tokens: Token[] = [];
    const cursor = rootCursor;

    /** Parent types, so an identifier can be read in context. */
    const ancestry: string[] = [];

    for (;;) {
      const type = cursor.nodeType;
      const named = cursor.nodeIsNamed;

      const token = tokenFor(languageId, {
        type,
        named,
        parentType: ancestry[ancestry.length - 1],
      });

      const start = cursor.startPosition;
      const end = cursor.endPosition;

      if (token !== null && start.row === end.row) {
        // Single-line only. A multi-line token would run off the end of its row in the
        // encoding, and the things worth painting - names, keywords, numbers - are all on
        // one line by nature. A multi-line string keeps Monaco's colouring.
        tokens.push({
          line: start.row,
          column: start.column,
          length: end.column - start.column,
          type: token,
        });
      }

      // Descend, unless this node's insides are already covered by the node itself.
      if (!isOpaque(type) && cursor.gotoFirstChild()) {
        ancestry.push(type);
        continue;
      }

      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return tokens;
        ancestry.pop();
      }
    }
  }

  const legend: monaco.languages.SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [],
  };

  const provider: monaco.languages.DocumentSemanticTokensProvider = {
    getLegend: () => legend,
    releaseDocumentSemanticTokens: () => undefined,

    async provideDocumentSemanticTokens(model) {
      if (!enabled) return null;

      const text = model.getValue();
      if (text.length > MAX_LENGTH) return null;

      const parser = await parserFor(model.getLanguageId());
      if (parser === null) return null;

      try {
        const tree = parser.parse(text);
        if (tree === null) return null;

        return { data: encodeTokens(collect(tree.walk(), model.getLanguageId())) };
      } catch {
        // A parse that throws costs the colouring layer, never the editor.
        return null;
      }
    },
  };

  const registrations = monacoApi.languages
    .getLanguages()
    .filter((language) => grammarFileFor(language.id) !== null)
    .map((language) =>
      monacoApi.languages.registerDocumentSemanticTokensProvider(language.id, provider),
    );

  return {
    setEnabled(next) {
      enabled = next;
    },
    dispose() {
      for (const registration of registrations) registration.dispose();
    },
  };
}

/**
 * The slice of tree-sitter's cursor this file uses.
 *
 * Declared structurally rather than imported so the module's types are not loaded at parse
 * time - `web-tree-sitter` is a dynamic import precisely so its wasm is not.
 */
interface TreeCursorLike {
  readonly nodeType: string;
  readonly nodeIsNamed: boolean;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}
