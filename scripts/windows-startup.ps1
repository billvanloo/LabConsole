<#
Lab Console on a Windows PC that is both the server and the display (e.g. a large touchscreen):
starts the console when you sign in, restarts it if it stops, keeps the PC and screen awake
while it runs, and shows the dashboard full screen in Microsoft Edge.

Run from Git Bash or PowerShell, in the LabConsole folder:

  powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Check      # report only
  powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Install    # set it up and start it
  powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Restart    # after a git pull
  powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Stop
  powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Uninstall

-Install adds two shortcuts for the signed-in user (no admin rights needed): one in the Startup
folder, so the console starts at sign-in, and a "Lab Console" one on the desktop, which reopens
the full-screen dashboard (and starts the console if it isn't running). Safe to run again.
-NoKiosk (with -Install, or when run with no switch) starts the console without opening Edge.
Leave full screen with Alt+F4.
Running it with no switch is what the shortcuts do: start the console, or, if it's already
running, just open the dashboard.

Written for Windows PowerShell 5.1, which every Windows 10/11 PC has.
#>
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Check,
    [switch]$Restart,
    [switch]$Stop,
    [switch]$NoKiosk
)
# Not "Stop": in Windows PowerShell 5.1 that turns any stderr output from a program this
# script runs (pip's warnings, a failed import check) into a script-ending error. Failures
# are checked explicitly instead ($LASTEXITCODE, try/catch with -ErrorAction Stop).
$ErrorActionPreference = "Continue"

$Root     = Split-Path -Parent $PSScriptRoot
$Script   = $PSCommandPath
$Python   = Join-Path $Root ".venv\Scripts\python.exe"
$Server   = Join-Path $Root "server.py"
$Config   = Join-Path $Root "config.json"
$ErrLog   = Join-Path $Root "lab-console.stderr.log"   # Python's own crash output, if any
$SupLog   = Join-Path $Root "lab-console.supervisor.log"
$KioskDir = Join-Path $env:LOCALAPPDATA "LabConsole\kiosk"   # Edge profile just for the kiosk
$Startup  = Join-Path ([Environment]::GetFolderPath("Startup")) "Lab Console.lnk"
$Desktop  = Join-Path ([Environment]::GetFolderPath("Desktop")) "Lab Console.lnk"

function Ok($m)   { Write-Host "  [ ok ] $m" }
function Info($m) { Write-Host "  [ .. ] $m" }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }
function Log($m) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
    try { Add-Content -Path $SupLog -Value $line -Encoding UTF8 } catch { }
}

function Get-Port {
    try {
        $c = Get-Content -Raw -Encoding UTF8 -ErrorAction Stop $Config | ConvertFrom-Json -ErrorAction Stop
        if ($c.http_port) { return [int]$c.http_port }
    } catch { }
    return 8080
}

function Test-Console($port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$port/" -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Wait-Console($port, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Console $port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

# python.exe processes running this checkout's server.py
function Get-ServerProcs {
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Server*" }
}

# powershell.exe processes supervising (this script without a switch)
function Get-SupervisorProcs {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Script*" -and
                       $_.ProcessId -ne $PID -and
                       $_.CommandLine -notmatch "-(Install|Uninstall|Check|Restart|Stop)\b" }
}

function Open-Kiosk($port) {
    $url = "http://localhost:$port/"
    # A separate Edge profile makes this a new Edge instance, so --kiosk applies even
    # when Edge is already open for something else.
    $edgeArgs = @("--kiosk", $url, "--edge-kiosk-type=fullscreen", "--no-first-run",
                  "--user-data-dir=`"$KioskDir`"")
    try {
        Start-Process -FilePath "msedge" -ArgumentList $edgeArgs -ErrorAction Stop | Out-Null
    } catch {
        Log "could not open Edge ($($_.Exception.Message)); opening the default browser"
        Start-Process $url | Out-Null
    }
}

function New-Shortcut($path, $description) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($path)
    $lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $kiosk = ""
    if ($NoKiosk) { $kiosk = " -NoKiosk" }
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`"$kiosk"
    $lnk.WorkingDirectory = $Root
    $lnk.WindowStyle = 7          # minimized: no console window flashing up
    $lnk.Description = $description
    $lnk.Save()
}

# Keep the PC and display awake while the console runs (no admin rights or power-plan
# change needed; it ends with this process). Locked-down PCs can refuse Add-Type.
function Keep-Awake {
    try {
        Add-Type -ErrorAction Stop -Namespace LabConsole -Name Power -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint flags);
"@
        # ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED = 0x80000003
        [void][LabConsole.Power]::SetThreadExecutionState([uint32]2147483651)
        Log "keeping the PC and display awake while the console runs"
    } catch {
        Log "could not keep the PC awake ($($_.Exception.Message)); set Power & sleep to Never instead"
    }
}

# ------------------------------------------------------------------ checks
function Invoke-Checks([bool]$fix) {
    Write-Host "Lab Console on Windows: $Root"
    if (-not (Test-Path $Server)) { Fail "$Root doesn't look like a Lab Console checkout (no server.py)" }

    if (-not (Test-Path $Python)) {
        if (-not $fix) { Warn "no .venv yet (-Install creates it)" }
        else {
            Info "creating .venv and installing requirements"
            & py -m venv (Join-Path $Root ".venv")
            if ($LASTEXITCODE -ne 0) { Fail "couldn't create .venv: install Python (winget install -e --id Python.Python.3.12 --scope user) and try again" }
        }
    }
    if (Test-Path $Python) {
        & $Python -c "import aiohttp, paho.mqtt" 2>$null
        if ($LASTEXITCODE -ne 0) {
            if (-not $fix) { Warn ".venv is missing aiohttp or paho-mqtt (-Install installs them)" }
            else {
                Info "installing requirements into .venv"
                & $Python -m pip install -q --disable-pip-version-check -r (Join-Path $Root "requirements.txt")
                if ($LASTEXITCODE -ne 0) { Fail "pip install failed; see the error above" }
            }
        }
        & $Python -c "import aiohttp, paho.mqtt" 2>$null
        if ($LASTEXITCODE -eq 0) { Ok ".venv has aiohttp and paho-mqtt" }
    }

    if (-not (Test-Path $Config)) { Fail "no config.json in $Root" }
    if (Test-Path $Python) {
        # (single quotes only in this Python: 5.1 mangles double quotes passed to programs)
        $report = & $Python -c @"
import json, sys
try:
    c = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception as e:
    print('ERR config.json is not valid JSON: %s' % e); sys.exit()
ps = c.get('printers') or []
if not ps:
    print('ERR config.json lists no printers'); sys.exit()
for i, p in enumerate(ps, 1):
    gaps = [k for k in ('id', 'serial', 'access_code') if not p.get(k)]
    if gaps:
        print('ERR printer %d (%s) has no %s' % (i, p.get('name', p.get('id', '?')), ', '.join(gaps))); sys.exit()
print('OK config.json lists %d printer(s): %s' % (len(ps), ', '.join(str(p.get('name', p.get('id'))) for p in ps)))
"@ $Config
        foreach ($line in $report) {
            if ($line -like "ERR *") { Fail $line.Substring(4) }
            if ($line -like "OK *")  { Ok $line.Substring(3) }
        }
    }

    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok "ffmpeg is installed" }
    else { Warn "ffmpeg isn't installed: X1/H2D cameras won't show (winget install -e --id Gyan.FFmpeg)" }

    if (Get-Command msedge -ErrorAction SilentlyContinue) { Ok "Microsoft Edge found (full-screen dashboard)" }
    elseif (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") { Ok "Microsoft Edge found (full-screen dashboard)" }
    else { Warn "Microsoft Edge not found: the dashboard will open in the default browser, not full screen" }
}

function Show-Status {
    $port = Get-Port
    if (Test-Path $Startup) { Ok "starts when $env:USERNAME signs in (Startup shortcut)" } else { Warn "not set to start at sign-in" }
    if (Test-Path $Desktop) { Ok "'Lab Console' desktop shortcut present" } else { Warn "no 'Lab Console' desktop shortcut" }
    $sup = @(Get-SupervisorProcs); $srv = @(Get-ServerProcs)
    if ($sup.Count) { Ok "supervisor running (restarts the console if it stops)" } else { Warn "supervisor not running" }
    if (Test-Console $port) { Ok "the console answers at http://localhost:$port/" }
    elseif ($srv.Count) { Warn "server.py is running but not answering on port $port yet" }
    else { Warn "the console isn't running" }
}

# ------------------------------------------------------------------ actions
if ($Check) { Invoke-Checks $false; Show-Status; exit 0 }

if ($Stop -or $Uninstall) {
    foreach ($p in @(Get-SupervisorProcs)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($p in @(Get-ServerProcs))     { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Ok "stopped the console"
    if ($Uninstall) {
        foreach ($l in @($Startup, $Desktop)) { if (Test-Path $l) { Remove-Item $l -Force } }
        Ok "removed the Startup and desktop shortcuts"
        Write-Host "The files in $Root are untouched; run it by hand with .venv\Scripts\python server.py config.json"
    }
    exit 0
}

if ($Restart) {
    # Stop only server.py: the supervisor starts it again within a few seconds, on the new code.
    $srv = @(Get-ServerProcs)
    if (-not @(Get-SupervisorProcs).Count) { Fail "the console isn't running under the supervisor; use -Install, or the desktop shortcut" }
    foreach ($p in $srv) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Info "restarting the console"
    if (Wait-Console (Get-Port) 40) { Ok "the console answers again" } else { Fail "the console didn't come back within 40 s; see $SupLog and $ErrLog" }
    exit 0
}

if ($Install) {
    Invoke-Checks $true
    New-Shortcut $Startup "Start Lab Console at sign-in"
    Ok "added the Startup shortcut: it starts when $env:USERNAME signs in"
    New-Shortcut $Desktop "Open the Lab Console dashboard"
    Ok "added a 'Lab Console' desktop shortcut"
    $port = Get-Port
    if (Test-Console $port) {
        if (-not @(Get-SupervisorProcs).Count) {
            Warn "something already answers on port $port, probably the console started by hand. Close that window, then run -Install again (or sign out and back in)."
            exit 0
        }
        Ok "already running"
    } else {
        Info "starting the console"
        $kiosk = @()
        if ($NoKiosk) { $kiosk = @("-NoKiosk") }
        Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList (@(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$Script`"") + $kiosk) | Out-Null
        if (Wait-Console $port 60) { Ok "the console answers at http://localhost:$port/" }
        else { Fail "the console didn't answer within 60 s; see $SupLog and $ErrLog" }
    }
    Write-Host ""
    Write-Host "Dashboard: http://localhost:$port/   (full screen: Alt+F4 leaves it; the desktop shortcut reopens it)"
    Write-Host "Update:    git pull, then powershell -ExecutionPolicy Bypass -File scripts/windows-startup.ps1 -Restart"
    exit 0
}

# ------------------------------------------------------------------ run (what the shortcuts do)
$port = Get-Port
# One supervisor per PC: a second launch (the desktop shortcut) just opens the dashboard.
$mutex = New-Object System.Threading.Mutex($false, "Local\LabConsoleSupervisor")
try { $mine = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $mine = $true }   # previous supervisor was killed
if (-not $mine) {
    if (-not $NoKiosk) { if (Wait-Console $port 60) { Open-Kiosk $port } }
    exit 0
}
if (Test-Console $port) {
    Log "port $port already answers (a console started by hand?); not starting another"
    if (-not $NoKiosk) { Open-Kiosk $port }
    exit 0
}
if (-not (Test-Path $Python)) { Log "no .venv; run -Install first"; exit 1 }

Set-Location $Root
Keep-Awake
Log "supervisor started"
$opened = $NoKiosk.IsPresent
$delay = 5
while ($true) {
    $started = Get-Date
    # --no-prompt: there's nobody at a terminal to answer the startup address check; the
    # dashboard asks instead.
    $proc = Start-Process -FilePath $Python -ArgumentList @("`"$Server`"", "`"$Config`"", "--no-prompt") `
        -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardError $ErrLog -PassThru
    Log "console started (pid $($proc.Id))"
    if (-not $opened) {
        if (Wait-Console $port 60) { Open-Kiosk $port; $opened = $true }
        else { Log "console didn't answer within 60 s; not opening the dashboard yet" }
    }
    $proc.WaitForExit()
    $ran = ((Get-Date) - $started).TotalSeconds
    Log ("console exited with code {0} after {1:N0} s" -f $proc.ExitCode, $ran)
    # Back off when it keeps failing straight away (e.g. a broken config.json), so the PC isn't
    # spinning; a console that ran a while gets restarted quickly.
    if ($ran -gt 60) { $delay = 5 } else { $delay = [Math]::Min($delay * 2, 120) }
    Start-Sleep -Seconds $delay
}
