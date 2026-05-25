use pmd_app_lib::{cli, cmd, path_scope::PathScope, AppState};
use tauri::{Emitter, Manager};

fn main() {
    let scope = PathScope::new();
    let args = cli::parse_argv(&scope);

    if args.list_themes {
        if let Err(e) = cli::print_theme_list() {
            eprintln!("failed to list themes: {e}");
            std::process::exit(1);
        }
        return;
    }

    let initial_path = args.initial_path.clone();

    // Pre-populate AppState with the path the CLI already admitted to its
    // local scope. The watcher and `current_path` are set after the Tauri
    // app is up so we have an `AppHandle` to drive event emission.
    let state = AppState {
        scope,
        initial_path: std::sync::Mutex::new(initial_path.clone()),
        open_dialog_on_start: std::sync::Mutex::new(args.open_dialog),
        current_path: std::sync::Mutex::new(initial_path.clone()),
        watcher: pmd_app_lib::watcher::FileWatcher::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            cmd::file::open_file,
            cmd::file::request_open_file,
            cmd::file::save_file,
            cmd::file::open_dialog,
            cmd::file::save_dialog,
            cmd::file::clear_active_file,
            cmd::theme::list_themes,
            cmd::theme::set_theme,
            cmd::settings::get_settings,
            cmd::settings::set_active_theme,
            cmd::settings::set_default_mode,
            cmd::settings::set_theme_pair,
            cmd::settings::set_auto_switch,
            cmd::settings::get_recent_files,
            cmd::settings::add_recent_file,
            cmd::settings::clear_recent_files,
            cmd::file::get_initial_path,
            cmd::file::get_open_dialog_on_start,
            cmd::window::set_window_title,
        ])
        .setup(move |app| {
            if let Some(ref p) = args.initial_path {
                let _ = app.emit("open-file", p.to_string_lossy().to_string());
                app.state::<AppState>()
                    .watcher
                    .set_target(app.handle().clone(), p.clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
