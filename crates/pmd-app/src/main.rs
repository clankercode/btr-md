use pmd_app_lib::{cli, cmd, path_scope::PathScope, watcher::FileWatcher, AppState};
use tauri::{Emitter, Manager};

fn main() {
    let scope = PathScope::new();
    let initial = cli::parse_argv(&scope);

    let initial_path = initial.path.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            scope,
            initial_path: std::sync::Mutex::new(initial_path),
        })
        .manage(FileWatcher::new())
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            cmd::file::open_file,
            cmd::file::request_open_file,
            cmd::file::save_file,
            cmd::file::open_dialog,
            cmd::file::save_dialog,
            cmd::theme::list_themes,
            cmd::theme::set_theme,
            cmd::settings::get_settings,
            cmd::settings::set_default_mode,
            cmd::settings::set_theme_pair,
            cmd::settings::set_auto_switch,
            cmd::settings::get_recent_files,
            cmd::settings::add_recent_file,
            cmd::settings::clear_recent_files,
            cmd::file::get_initial_path,
            cmd::window::set_window_title,
        ])
        .setup(move |app| {
            if let Some(ref p) = initial.path {
                let _ = app.emit("open-file", p.to_string_lossy().to_string());
                app.state::<FileWatcher>()
                    .watch(app.handle().clone(), p.clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
