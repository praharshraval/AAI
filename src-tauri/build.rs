/// Tauri v2 build script.
///
/// This script is executed by Cargo during the build process and invokes
/// the Tauri build system to generate the necessary bindings and resources
/// for the desktop application.
fn main() {
    tauri_build::build();
}
