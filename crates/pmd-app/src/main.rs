use pmd_app_lib::{cli, cmd, path_scope::PathScope, AppState};
use tauri::Emitter;

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

    // The CLI already admitted `initial_path` to the local scope. The document
    // itself is registered (and its watcher started) by the frontend's open
    // flow once the app is up, via `request_open_file` / `open_file`.
    let state = AppState {
        scope,
        initial_path: std::sync::Mutex::new(initial_path.clone()),
        open_dialog_on_start: std::sync::Mutex::new(args.open_dialog),
        docs: pmd_app_lib::doc::DocRegistry::new(),
        watcher: pmd_app_lib::watcher::WatcherSet::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            cmd::file::open_file,
            cmd::file::request_open_file,
            cmd::file::open_dialog,
            cmd::file::save_dialog,
            cmd::doc::register_doc,
            cmd::doc::set_active_doc,
            cmd::doc::doc_edited,
            cmd::doc::save_doc,
            cmd::doc::pull_from_disk,
            cmd::doc::resolve_disk_change,
            cmd::doc::drop_doc,
            cmd::theme::list_themes,
            cmd::theme::set_theme,
            cmd::settings::get_settings,
            cmd::settings::set_active_theme,
            cmd::settings::set_default_mode,
            cmd::settings::set_theme_pair,
            cmd::settings::set_auto_switch,
            cmd::settings::set_autosave_mode,
            cmd::settings::set_autoreload_mode,
            cmd::settings::set_merge_strategy,
            cmd::settings::get_recent_files,
            cmd::settings::clear_recent_files,
            cmd::file::get_initial_path,
            cmd::file::get_open_dialog_on_start,
            cmd::window::set_window_title,
        ])
        .setup(move |app| {
            // The watcher + registry entry for the initial file are created by
            // the frontend's open flow; here we only nudge it to open.
            if let Some(ref p) = args.initial_path {
                let _ = app.emit("open-file", p.to_string_lossy().to_string());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
