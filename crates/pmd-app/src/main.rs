use pmd_app_lib::{cli, cmd, path_scope::PathScope, AppState};

fn main() {
    let scope = PathScope::new();
    let initial = cli::parse_argv(&scope);

    tauri::Builder::default()
        .manage(AppState { scope })
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            cmd::file::open_file,
            cmd::file::save_file,
            cmd::theme::list_themes,
            cmd::theme::set_theme,
            cmd::settings::get_settings,
            cmd::settings::set_default_mode,
            cmd::settings::set_theme_pair,
            cmd::settings::set_auto_switch,
            cmd::settings::get_recent_files,
            cmd::settings::add_recent_file,
        ])
        .setup(move |_app| {
            if let Some(_p) = initial.path {}
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
