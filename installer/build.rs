// Puts TruckPlay's version, icon and manifest into the installer. The version comes from
// host/package.json, so the installer always says which TruckPlay it carries.

use std::path::PathBuf;
use std::{env, fs};

fn main() {
    let here = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = here.parent().expect("repository").to_path_buf();
    let package = root.join("host").join("package.json");
    let icon = root.join("plugin").join("setup").join("truckplay.ico");
    let manifest = here.join("res").join("app.manifest");
    for f in [&package, &icon, &manifest] {
        println!("cargo:rerun-if-changed={}", f.display());
    }

    let text = fs::read_to_string(&package).expect("host/package.json");
    let version = text
        .split("\"version\"")
        .nth(1)
        .and_then(|rest| rest.split('"').nth(1))
        .expect("a version in host/package.json")
        .to_string();
    println!("cargo:rustc-env=TRUCKPLAY_VERSION={version}");

    let n: Vec<u16> = version.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    let (a, b, c) = (
        n.first().copied().unwrap_or(0),
        n.get(1).copied().unwrap_or(0),
        n.get(2).copied().unwrap_or(0),
    );
    let slashes = |p: &PathBuf| p.display().to_string().replace('\\', "/");
    let rc = format!(
        r#"#pragma code_page(65001)
1 ICON "{icon}"
1 24 "{manifest}"
1 VERSIONINFO
FILEVERSION {a},{b},{c},0
PRODUCTVERSION {a},{b},{c},0
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "041f04b0"
    BEGIN
      VALUE "CompanyName", "TruckPlay"
      VALUE "FileDescription", "TruckPlay kurulumu"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "TruckPlay-Kurulum"
      VALUE "LegalCopyright", "TruckPlay"
      VALUE "OriginalFilename", "TruckPlay-Kurulum.exe"
      VALUE "ProductName", "TruckPlay"
      VALUE "ProductVersion", "{version}"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x41f, 1200
  END
END
"#,
        icon = slashes(&icon),
        manifest = slashes(&manifest),
    );
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let rc_file = out.join("truckplay-setup.rc");
    fs::write(&rc_file, rc).expect("resource script");
    embed_resource::compile(&rc_file, embed_resource::NONE)
        .manifest_required()
        .expect("resources");
}
