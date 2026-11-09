# TruckPlay {{version}} kurulumu. TruckPlay-Kurulum.exe bu betiği kendi içinden açtığı dosyalarla çalıştırır:
#   - TruckPlay'i %LOCALAPPDATA%\TruckPlay klasörüne kurar (güncellemede harita verisi korunur),
#   - oyun eklentisini oyunun bin\win_x64\plugins klasörüne koyar,
#   - modu oyuncunun kendi oyun dosyalarından üretip Belgeler\Euro Truck Simulator 2\mod içine koyar,
#   - harita verisini indirir, masaüstüne ve Başlat menüsüne kısayol koyar,
#   - Windows'un uygulama listesine yazılır (Ayarlar > Uygulamalar'dan kaldırılabilir).
#   TruckPlay-Kurulum.exe -Uninstall   her şeyi kaldırır
#   TruckPlay-Kurulum.exe -GameDir "D:\Oyunlar\Euro Truck Simulator 2"   oyun bulunamazsa

param(
  [string]$Source = $PSScriptRoot,
  [string]$GameDir = '',
  [switch]$Uninstall,
  [switch]$NoMap,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
# Windows PowerShell 5 may still offer only TLS 1.0 by default; the map servers want 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$install = Join-Path $env:LOCALAPPDATA 'TruckPlay'
$exe = Join-Path $install 'TruckPlay.exe'
$app = Join-Path $install 'resources\app'
$docs = [Environment]::GetFolderPath('MyDocuments')
$modDir = Join-Path $docs 'Euro Truck Simulator 2\mod'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'TruckPlay'
$demoLink = Join-Path $desktop 'TruckPlay (deneme).lnk'
# Windows' list of installed apps (Settings > Apps), for this user: no administrator needed.
$appsKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\TruckPlay'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Step($text) { Write-Host "`n  » $text" -ForegroundColor Cyan }
function Done($text) { Write-Host "    $text" -ForegroundColor DarkGray }

function Find-Game {
  if ($GameDir -and (Test-Path (Join-Path $GameDir 'base.scs'))) { return $GameDir }
  $steam = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) {
      foreach ($line in Get-Content $vdf) { if ($line -match '"path"\s+"(.+)"') { $libs += ($matches[1] -replace '\\\\', '\') } }
    }
  }
  foreach ($lib in $libs | Select-Object -Unique) {
    $p = Join-Path $lib 'steamapps\common\Euro Truck Simulator 2'
    if (Test-Path (Join-Path $p 'base.scs')) { return $p }
  }
  return $null
}

function Stop-TruckPlay {
  foreach ($name in 'TruckPlay', 'truckplay-media', 'tirplay-media') {
    Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  # The developer build of the old name ran under electron.exe from its own folder.
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'ets2 ekran|tirplay|truckplay' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
}

# The earlier name of this mod (TırPlay): its files go, so the game does not load two plugins.
function Remove-Old($plugins) {
  if ($plugins) {
    Remove-Item (Join-Path $plugins 'tirplay.dll') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $plugins 'tirplay') -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item (Join-Path $modDir 'tirplay.scs') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $desktop 'TırPlay.lnk') -Force -ErrorAction SilentlyContinue
  # Before 1.7 the trial window's desktop shortcut was called just "TruckPlay": it looked like the
  # way to start TruckPlay, which starts with the game by itself.
  Remove-Item (Join-Path $desktop 'TruckPlay.lnk') -Force -ErrorAction SilentlyContinue
}

# Where a file really is on disk. Run from inside an app package (an MSIX app such as a store app
# or Claude), Windows quietly moves writes under AppData into that package's own storage; the game,
# outside the package, would not find TruckPlay at the usual path. The real path works for both.
function Real-Path($file) {
  try {
    if (-not ('TruckPlayFinalPath' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TruckPlayFinalPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandleW(IntPtr h, StringBuilder path, uint size, uint flags);
  public static string Of(string file) {
    using (var fs = new System.IO.FileStream(file, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite | System.IO.FileShare.Delete)) {
      var sb = new StringBuilder(1024);
      uint n = GetFinalPathNameByHandleW(fs.SafeFileHandle.DangerousGetHandle(), sb, 1024, 0);
      if (n == 0 || n >= 1024) return file;
      var s = sb.ToString();
      if (s.StartsWith(@"\\?\UNC\")) return @"\\" + s.Substring(8);
      if (s.StartsWith(@"\\?\")) return s.Substring(4);
      return s;
    }
  }
}
'@
    }
    return [TruckPlayFinalPath]::Of($file)
  } catch {
    return $file
  }
}

function Shortcut($path, $target, $arguments, $description) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = Split-Path $target
  $lnk.IconLocation = "$target,0"
  $lnk.Description = $description
  $lnk.Save()
}

Write-Host "`n  TruckPlay {{version}}" -ForegroundColor White
$game = Find-Game
if (-not $game -and -not $Uninstall) {
  Write-Host "`n  Euro Truck Simulator 2 bulunamadı." -ForegroundColor Yellow
  Write-Host '  Oyun klasörünü yaz (içinde base.scs olan klasör), ya da boş bırakıp Enter''a bas:'
  $GameDir = Read-Host '  '
  $game = Find-Game
}
$plugins = if ($game) { Join-Path $game 'bin\win_x64\plugins' } else { $null }
if ($game) { Done "Oyun: $game" }

while (Get-Process eurotrucks2 -ErrorAction SilentlyContinue) {
  Write-Host "`n  Oyun açık. Kapatınca kurulum kendiliğinden devam eder…" -ForegroundColor Yellow
  while (Get-Process eurotrucks2 -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
}
Stop-TruckPlay

if ($Uninstall) {
  Step 'Kaldırılıyor'
  if ($plugins) {
    Remove-Item (Join-Path $plugins 'truckplay.dll') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $plugins 'truckplay') -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item (Join-Path $modDir 'truckplay.scs') -Force -ErrorAction SilentlyContinue
  Remove-Item $demoLink -Force -ErrorAction SilentlyContinue
  Remove-Item $startMenu -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $appsKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Old $plugins
  Remove-Item $install -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "`n  TruckPlay kaldırıldı." -ForegroundColor Green
  if (-not $Quiet) { Read-Host "`n  Kapatmak için Enter'a bas" | Out-Null }
  return
}

Step 'Uygulama kuruluyor'
New-Item -ItemType Directory -Force $install | Out-Null
# Mirror the new files in; the downloaded map data (115 MB) steps aside meanwhile and comes back.
$mapKeep = Join-Path $install 'resources\app\map\data'
$mapAside = "$install-mapdata"
if (Test-Path $mapKeep) {
  Remove-Item $mapAside -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item $mapKeep $mapAside
}
& robocopy $Source $install /MIR /XF setup.ps1 /NFL /NDL /NJH /NJS /NP | Out-Null
$copied = $LASTEXITCODE
if (Test-Path $mapAside) {
  Remove-Item $mapKeep -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force (Split-Path $mapKeep) | Out-Null
  Move-Item $mapAside $mapKeep
}
if ($copied -ge 8) { throw "Dosyalar kopyalanamadı (robocopy $copied)." }
Copy-Item (Join-Path $Source 'setup.ps1') (Join-Path $install 'setup.ps1') -Force
Done $install
Remove-Old $plugins

if ($plugins) {
  Step 'Oyun eklentisi'
  New-Item -ItemType Directory -Force (Join-Path $plugins 'truckplay') | Out-Null
  Copy-Item (Join-Path $install 'game\truckplay.dll') (Join-Path $plugins 'truckplay.dll') -Force
  # The plugin starts TruckPlay with the game, with this command: the exe's real place on disk.
  $realExe = Real-Path $exe
  if ($realExe -ne $exe) { Done "Uygulama paketinin deposunda: $realExe" }
  [IO.File]::WriteAllText((Join-Path $plugins 'truckplay\launch.txt'), "`"$realExe`"", (New-Object Text.UTF8Encoding($false)))
  Done $plugins

  Step 'Mod: senin oyununun dosyalarından üretiliyor'
  New-Item -ItemType Directory -Force $modDir | Out-Null
  # TruckPlay.exe is also Node.js: it measures every cab screen of this game version and of every
  # truck the player owns, and writes the mod. If that fails, the ready-made mod is used.
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $exe (Join-Path $app 'mod\build-mod.mjs') --game $game --out (Join-Path $modDir 'truckplay.scs') | ForEach-Object { if ($_ -match 'files,|→') { Done $_ } }
  $built = $LASTEXITCODE -eq 0
  if (-not $NoMap) {
    & $exe (Join-Path $app 'map\build-cities.mjs') --game $game --out (Join-Path $app 'map\data\cities.json') | Out-Null
  }
  Remove-Item Env:\ELECTRON_RUN_AS_NODE
  if (-not $built) {
    Write-Warning 'Mod üretilemedi; hazır mod kopyalanıyor.'
    Copy-Item (Join-Path $install 'game\truckplay.scs') (Join-Path $modDir 'truckplay.scs') -Force
  }
  Done (Join-Path $modDir 'truckplay.scs')
} else {
  Write-Warning 'Oyun bulunamadığı için eklenti ve mod kurulmadı. Kurulumu oyun klasörüyle yeniden çalıştır.'
}

if (-not $NoMap) {
  Step 'Harita verisi'
  # Roads, cities and buildings: tiles published by the truckermudgeon/maps project.
  $mapData = Join-Path $app 'map\data'
  New-Item -ItemType Directory -Force $mapData | Out-Null
  $mapFiles = [ordered]@{
    'ets2.pmtiles'            = 'https://maps.truckermudgeon.com/ets2.pmtiles'
    'ets2-footprints.pmtiles' = 'https://maps.truckermudgeon.com/ets2-footprints.pmtiles'
    'world.pmtiles'           = 'https://maps.truckermudgeon.com/world.pmtiles'
    'ets2-search.geojson'     = 'https://truckermudgeon.github.io/ets2-search.geojson'
  }
  foreach ($name in $mapFiles.Keys) {
    $file = Join-Path $mapData $name
    if (Test-Path $file) { Done "$name (var)"; continue }
    Done "$name indiriliyor…"
    try { Invoke-WebRequest -Uri $mapFiles[$name] -OutFile $file -UseBasicParsing }
    catch { Remove-Item $file -ErrorAction SilentlyContinue; Write-Warning "$name indirilemedi; Haritalar iz görünümüne düşer." }
  }
}

Step 'Kısayollar'
# TruckPlay starts with the game by itself; the shortcut is only the window to try it without one.
Shortcut $demoLink $exe '--window --demo' 'TruckPlay — oyunsuz deneme penceresi'
New-Item -ItemType Directory -Force $startMenu | Out-Null
Shortcut (Join-Path $startMenu 'TruckPlay (deneme).lnk') $exe '--window --demo' 'TruckPlay — oyunsuz deneme penceresi'
$uninstallArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $install 'setup.ps1')`" -Uninstall"
Shortcut (Join-Path $startMenu 'TruckPlay''i kaldır.lnk') $ps $uninstallArgs 'TruckPlay''i kaldır'
Done 'Masaüstü ve Başlat menüsü'

# Settings > Apps lists TruckPlay, with its own Uninstall button.
try {
  New-Item -Path $appsKey -Force | Out-Null
  $kb = [int]((Get-ChildItem $install -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
  $text = [ordered]@{
    DisplayName          = 'TruckPlay'
    DisplayVersion       = '{{version}}'
    Publisher            = 'TruckPlay'
    DisplayIcon          = "$exe,0"
    InstallLocation      = $install
    UninstallString      = "`"$ps`" $uninstallArgs"
    QuietUninstallString = "`"$ps`" $uninstallArgs -Quiet"
  }
  foreach ($k in $text.Keys) { New-ItemProperty -Path $appsKey -Name $k -Value $text[$k] -PropertyType String -Force | Out-Null }
  foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Path $appsKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  New-ItemProperty -Path $appsKey -Name 'EstimatedSize' -Value $kb -PropertyType DWord -Force | Out-Null
  Done 'Windows Ayarlar > Uygulamalar'
} catch {
  Write-Warning 'Windows uygulama listesine yazılamadı; kaldırmak için Başlat menüsündeki kısayolu kullan.'
}

Write-Host "`n  TruckPlay kuruldu." -ForegroundColor Green
Write-Host '  1. ETS2''yi aç. Açılışta eklenti uyarısı çıkar: Tamam.'
Write-Host '  2. Profil ekranında Mod Yöneticisi''nden TruckPlay''i etkinleştir (bir kere yeter).'
Write-Host '  3. Tıra bin: multimedya ekranı TruckPlay olur. G basılı = dokun, Y = ekranı büyüt.'
Write-Host '  TruckPlay oyunla kendiliğinden açılır. Oyun güncellenince modu kendisi yeniler.'
if (-not $Quiet) { Read-Host "`n  Kapatmak için Enter'a bas" | Out-Null }
