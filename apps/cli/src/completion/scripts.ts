import type { ShellName } from "./words.ts";

/**
 * The scripts each shell loads.
 *
 * They hold no word lists of their own: every Tab asks `adcode __complete`, which reads the
 * live vocabulary, model ids and saved sessions. The word being completed is always sent
 * last with an `@` in front, because Windows PowerShell 5.1 silently drops an empty
 * argument to a native program, and "complete from nothing" is the most common case.
 */

const BASH = `# adcode shell completion for bash
_adcode_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\\n'
  COMPREPLY=($(command adcode __complete "\${COMP_WORDS[@]:1:COMP_CWORD-1}" "@\${cur}" 2>/dev/null))
}
complete -o default -F _adcode_complete adcode
`;

const ZSH = `#compdef adcode
# adcode shell completion for zsh
_adcode() {
  local -a candidates
  candidates=("\${(@f)$(command adcode __complete "\${(@)words[2,CURRENT-1]}" "@\${words[CURRENT]}" 2>/dev/null)}")
  candidates=(\${candidates:#})
  if (( \${#candidates} )); then
    compadd -a candidates
  else
    _files
  fi
}
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit && compinit
fi
compdef _adcode adcode
`;

const FISH = `# adcode shell completion for fish
function __adcode_complete
    set -l tokens (commandline -opc)
    set -e tokens[1]
    command adcode __complete $tokens "@"(commandline -ct) 2>/dev/null
end
complete -c adcode -f -n 'not __fish_seen_subcommand_from app open' -a '(__adcode_complete)'
complete -c adcode -F -n '__fish_seen_subcommand_from app open'
`;

const POWERSHELL = `# adcode shell completion for PowerShell
Register-ArgumentCompleter -Native -CommandName adcode -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $before = @()
    foreach ($element in ($commandAst.CommandElements | Select-Object -Skip 1)) {
        if ($element.Extent.EndOffset -lt $cursorPosition) {
            if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
                $before += $element.Value
            } else {
                $before += $element.Extent.Text
            }
        }
    }
    $results = & adcode __complete @before "@$wordToComplete" 2>$null
    foreach ($item in $results) {
        if ($item) {
            [System.Management.Automation.CompletionResult]::new($item, $item, 'ParameterValue', $item)
        }
    }
}
`;

export function completionScript(shell: ShellName): string {
  switch (shell) {
    case "bash":
      return BASH;
    case "zsh":
      return ZSH;
    case "fish":
      return FISH;
    case "powershell":
      return POWERSHELL;
  }
}

export function scriptExtension(shell: ShellName): string {
  return shell === "powershell" ? "ps1" : shell;
}
