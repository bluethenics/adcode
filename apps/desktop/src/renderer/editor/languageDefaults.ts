/**
 * What Monaco's language workers should and should not complain about.
 *
 * These workers run in the browser with no filesystem and no `node_modules`. That makes
 * some of their diagnostics true statements about the worker's world and false statements
 * about the user's, and a Problems panel is only worth reading if everything in it is
 * worth acting on. One false alarm on a file the user did not write teaches them to ignore
 * the panel, and after that the real error is invisible too.
 *
 * Every suppression here is a diagnostic that is *unanswerable by construction* - not one
 * that is merely inconvenient. When the language server lands it will resolve modules for
 * real, and these codes become meaningful again; the explanation table already carries
 * entries for them, waiting.
 */
import {
  JsxEmit,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  javascriptDefaults,
  typescriptDefaults,
} from "monaco-editor/languages/features/typescript/register.js";
import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";

/**
 * Module resolution the worker cannot perform.
 *
 * - 2307 "Cannot find module 'x'" - there is no `node_modules` in a web worker, so every
 *   import of a real dependency reports this. It is the single loudest false alarm
 *   available, and it fires on the first line of nearly every file in a real project.
 * - 2792 the same thing, with advice about `moduleResolution` that does not apply here.
 * - 7016 "Could not find a declaration file" - the same missing package, one rung quieter.
 */
const UNRESOLVABLE_IMPORTS = [2307, 2792, 7016];

export function configureLanguageDefaults(): void {
  for (const defaults of [typescriptDefaults, javascriptDefaults]) {
    defaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: UNRESOLVABLE_IMPORTS });

    /*
     * Monaco's stock compiler options are ES5 and CommonJS, which describe no project
     * written this decade. Left alone they report `import.meta`, `??`, top-level await and
     * modern class syntax as errors - in files that compile perfectly well - and the
     * Problems panel fills with complaints about the language rather than the code.
     *
     * `strict` stays off, matching what `tsc` itself does when there is no tsconfig. It is
     * also the friendlier default for the person this panel is aimed at: an unannotated
     * parameter is how everyone's first function is written, and greeting it with an error
     * teaches nothing except that the editor is displeased.
     */
    defaults.setCompilerOptions({
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.NodeJs,
      jsx: JsxEmit.ReactJSX,
      allowJs: true,
      // Monaco names models `file:///c:/…/app.vue` and the like; without this the worker
      // refuses to look at anything whose extension it does not recognise.
      allowNonTsExtensions: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
    });
  }

  jsonDefaults.setDiagnosticsOptions({
    validate: true,

    /*
     * Never fetch a schema.
     *
     * A JSON file carrying `$schema: "https://..."` would otherwise make the renderer
     * issue a network request. The CSP's `connect-src 'self'` refuses it, which is the
     * correct outcome and also a console error - and `npm run smoke` fails the build on
     * any console error, so this would surface as a mysterious CI failure on the day a
     * user happened to open the wrong file.
     */
    enableSchemaRequest: false,

    /*
     * Comments stay an error in a `.json` file, because there they genuinely are one and a
     * beginner should be told. The tsconfig family is the documented exception: TypeScript
     * has always read those as JSONC, every real one in the wild has comments in it, and
     * flagging the file the compiler itself wrote is the definition of a false alarm.
     */
    schemas: [
      {
        uri: "adcode://schemas/jsonc",
        fileMatch: ["tsconfig.json", "tsconfig.*.json", "jsconfig.json", "jsconfig.*.json"],
        schema: { allowComments: true, allowTrailingCommas: true },
      },
    ],
  });
}
