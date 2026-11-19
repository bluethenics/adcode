# Keeps this computer from idle-sleeping while the command after it runs (a per-process request,
# like caffeinate - no power setting changes). Usage: powershell -File awake.ps1 bash rerun.sh
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Command)
Add-Type -Namespace Bench -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED
[Bench.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null
try { & $Command[0] $Command[1..($Command.Length - 1)] } finally { [Bench.Power]::SetThreadExecutionState([uint32]2147483648) | Out-Null }
