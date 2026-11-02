# TruckPlay kurulumu: arayüzü ve eklentiyi derler, modu oyunun dosyalarından üretir, eklentiyi
# oyuna kopyalar ve host'un oyunla birlikte açılmasını ayarlar. Oyun güncellenince yeniden çalıştır.
#
#   powershell -ExecutionPolicy Bypass -File scripts\kur.ps1                 # normal kurulum
#   powershell -ExecutionPolicy Bypass -File scripts\kur.ps1 -Mode calibrate # ekranı ölçmek için ızgara
#   powershell -ExecutionPolicy Bypass -File scripts\kur.ps1 -Uninstall      # kaldır

param(
  [ValidateSet('live', 'calibrate')] [string]$Mode = 'live',
  [string]$GameDir = '',
  [switch]$Uninstall,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Step($text) { Write-Host "`n» $text" -ForegroundColor Cyan }

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
  throw 'Euro Truck Simulator 2 bulunamadı. -GameDir ile klasörü ver.'
}

$game = Find-Game
$plugins = Join-Path $game 'bin\win_x64\plugins'
$docs = [Environment]::GetFolderPath('MyDocuments')
$modDir = Join-Path $docs 'Euro Truck Simulator 2\mod'
Write-Host "Oyun: $game"

if (Get-Process eurotrucks2 -ErrorAction SilentlyContinue) { throw 'Oyun açık. Önce ETS2''yi kapat.' }

if ($Uninstall) {
  Step 'Kaldırılıyor'
  Remove-Item (Join-Path $plugins 'truckplay.dll') -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $plugins 'truckplay') -Recurse -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $modDir 'truckplay.scs') -ErrorAction SilentlyContinue
  Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'TruckPlay.lnk') -ErrorAction SilentlyContinue
  Write-Host 'TruckPlay kaldırıldı.' -ForegroundColor Green
  return
}

if (-not $SkipBuild) {
  Step 'Arayüz bağımlılıkları'
  Push-Location (Join-Path $root 'ui'); if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit }; Step 'Arayüz derleniyor'; npx vite build; Pop-Location

  Step 'Host bağımlılıkları'
  Push-Location (Join-Path $root 'host'); if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit }; Pop-Location

  Step 'Oyun eklentisi derleniyor (MSVC)'
  & cmd /c "`"$(Join-Path $root 'scripts\build-plugin.cmd')`""
  if ($LASTEXITCODE -ne 0) { throw 'Eklenti derlenemedi.' }
}

Step 'Harita verisi'
# Yollar, şehirler ve binalar: truckermudgeon/maps projesinin oyun dosyalarından ürettiği döşemeler.
$mapData = Join-Path $root 'map\data'
New-Item -ItemType Directory -Force $mapData | Out-Null
$mapFiles = [ordered]@{
  'ets2.pmtiles'            = 'https://maps.truckermudgeon.com/ets2.pmtiles'
  'ets2-footprints.pmtiles' = 'https://maps.truckermudgeon.com/ets2-footprints.pmtiles'
  'world.pmtiles'           = 'https://maps.truckermudgeon.com/world.pmtiles'
  'ets2-search.geojson'     = 'https://truckermudgeon.github.io/ets2-search.geojson'
}
$ProgressPreference = 'SilentlyContinue'
foreach ($name in $mapFiles.Keys) {
  $file = Join-Path $mapData $name
  if (Test-Path $file) { continue }
  Write-Host "  $name indiriliyor…"
  try { Invoke-WebRequest -Uri $mapFiles[$name] -OutFile $file -UseBasicParsing }
  catch { Remove-Item $file -ErrorAction SilentlyContinue; Write-Warning "$name indirilemedi; Haritalar iz görünümüne düşer." }
}
# Şehir adları ve iş hedefleri için oyunun kendi şehir tablosu (Türkçe/İngilizce adlar).
node (Join-Path $root 'map\build-cities.mjs') --game $game
if ($LASTEXITCODE -ne 0) { Write-Warning 'Şehir tablosu üretilemedi.' }
# Yol tarifi (HUD) için oyunun kendi yol ağı: yollar, kavşaklar, feribotlar.
node (Join-Path $root 'map\build-graph.mjs') --game $game
if ($LASTEXITCODE -ne 0) { Write-Warning 'Yol ağı üretilemedi; Haritalar çizgiyi yine çizer ama dönüş tarifi olmaz.' }

Step "Mod üretiliyor ($Mode)"
node (Join-Path $root 'mod\build-mod.mjs') --mode $Mode --game $game --out (Join-Path $modDir 'truckplay.scs')
if ($LASTEXITCODE -ne 0) { throw 'Mod üretilemedi.' }

Step 'Eklenti oyuna kopyalanıyor'
New-Item -ItemType Directory -Force (Join-Path $plugins 'truckplay') | Out-Null
Copy-Item (Join-Path $root 'plugin\build\truckplay.dll') (Join-Path $plugins 'truckplay.dll') -Force
$electron = Join-Path $root 'host\node_modules\electron\dist\electron.exe'
$launch = "`"$electron`" `"$(Join-Path $root 'host')`""
[IO.File]::WriteAllText((Join-Path $plugins 'truckplay\launch.txt'), $launch, (New-Object Text.UTF8Encoding($false)))

Step 'Masaüstü kısayolu'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TruckPlay.lnk'))
$lnk.TargetPath = $electron
$lnk.Arguments = "`"$(Join-Path $root 'host')`" --window --demo"
$lnk.WorkingDirectory = Join-Path $root 'host'
$lnk.Description = 'TruckPlay — oyunsuz deneme penceresi'
$lnk.Save()

Write-Host "`nTruckPlay kuruldu." -ForegroundColor Green
Write-Host '1. ETS2''yi aç, profil ekranında Mod Yöneticisi''nden TruckPlay''i etkinleştir.'
Write-Host '2. Tıra bin: multimedya ekranı TruckPlay olur. G basılı = dokun, Y = ekrana yaklaş.'
Write-Host '   Host oyunla birlikte kendiliğinden açılır (elle: TruckPlay.cmd).'
