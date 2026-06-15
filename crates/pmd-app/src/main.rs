use pmd_app_lib::preview::link_activation::LinkActivationStore;
use pmd_app_lib::preview::render_pipeline::ValidationWorker;
use pmd_app_lib::{cli, cmd, path_scope::PathScope, AppState};
use tauri::{Emitter, Manager};

fn main() {
    let scope = PathScope::new();
    let args = cli::parse_argv(&scope);

    if let Some(ref input) = args.render_input {
        if let Err(e) =
            cli::run_headless_render(input, args.render_output.as_deref(), args.standalone)
        {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }

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
        sessions: pmd_app_lib::state::window_session::SessionStore::new(),
        mru: std::sync::Mutex::new(Default::default()),
    };

    tauri::Builder::default()
        // Single-instance (todo #7): a second `btr-md <file>` launch forwards
        // its file arguments to the already-running window instead of opening a
        // new app instance. MUST be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let state = app.state::<AppState>();
            for path in cli::forwarded_paths(&argv, &cwd) {
                // Existing files admit their parent dir (siblings browsable); a
                // not-yet-existing target is still admitted (resolved against
                // its nearest existing ancestor) so the renderer creates it on
                // open, mirroring the initial-path handling in `cli::parse_args`.
                let admitted = if path.exists() {
                    state.scope.allow_file_and_parent(&path)
                } else {
                    PathScope::resolve_creatable(&path)
                        .map(|(canon, _missing)| state.scope.allow_canonical(&canon))
                };
                match admitted {
                    Ok(canon) => {
                        let _ = app.emit("open-file", canon.to_string_lossy().to_string());
                    }
                    Err(e) => eprintln!("[btr-md] ignoring forwarded path {}: {e}", path.display()),
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // Track most-recently-focused window for launch routing. This global
        // handler covers ALL windows (restored at startup + future
        // `new_window`). Verified manually — there is no Tauri-runtime test.
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            let state = window.state::<AppState>();
            match event {
                tauri::WindowEvent::Focused(true) => {
                    state
                        .mru
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .touch(&label);
                }
                tauri::WindowEvent::Destroyed => {
                    state
                        .mru
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .remove(&label);
                }
                _ => {}
            }
        })
        .manage(state)
        .manage(LinkActivationStore::default())
        .manage(ValidationWorker::new())
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            pmd_app_lib::preview::link_activation::prepare_link_activation,
            pmd_app_lib::preview::link_activation::confirm_external_open,
            pmd_app_lib::preview::grants::grant_asset_folder,
            pmd_app_lib::preview::grants::grant_recommended_root,
            pmd_app_lib::preview::grants::revoke_asset_grant,
            pmd_app_lib::preview::grants::list_asset_grants,
            pmd_app_lib::preview::trust_roots::remember_declined_root,
            pmd_app_lib::preview::trust_roots::forget_trust_root,
            pmd_app_lib::preview::trust_roots::list_trust_roots,
            cmd::file::open_file,
            cmd::file::request_open_file,
            cmd::file::open_dialog,
            cmd::file::save_dialog,
            cmd::export::export_html,
            cmd::asset::import_image_asset,
            cmd::asset::paste_html_as_markdown,
            cmd::doc::register_doc,
            cmd::doc::set_active_doc,
            cmd::doc::doc_edited,
            cmd::doc::save_doc,
            cmd::doc::pull_from_disk,
            cmd::doc::resolve_disk_change,
            cmd::doc::drop_doc,
            cmd::browse::list_dir,
            cmd::browse::pick_base_dir,
            cmd::browse::set_workspace_root,
            cmd::browse::rename_path,
            cmd::reveal::open_in_default_app,
            cmd::reveal::reveal_in_folder,
            cmd::reveal::open_url,
            cmd::default_handler::default_handler_status,
            cmd::default_handler::set_as_default_handler,
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
            cmd::settings::set_gist_enabled,
            cmd::settings::set_diff_mode,
            cmd::settings::set_dont_ask_default_handler,
            cmd::settings::set_mono_font,
            cmd::settings::set_shortcut_overrides,
            cmd::settings::set_split_scroll_locked,
            cmd::settings::get_recent_files,
            cmd::settings::clear_recent_files,
            cmd::file::get_initial_path,
            cmd::file::get_open_dialog_on_start,
            cmd::window::set_window_title,
            cmd::window::new_window,
            cmd::window::save_window_session,
            cmd::window::get_window_session,
            cmd::window::window_closing,
            cmd::session::load_session,
            cmd::session::restore_dirty_doc,
        ])
        .setup(move |app| {
            // Restore spawner: replay persisted windows on a plain launch;
            // otherwise open a single "main" window (initial-path or empty).
            // Each window builds its own NavigationGate internally.
            let session = pmd_app_lib::state::session::load_session();
            app.state::<AppState>().sessions.seed(session.clone());
            // Prevent `new_window` from minting a label that collides with a
            // restored window (e.g. another `w-2`). Safe to call always.
            cmd::window::reserve_window_labels(session.windows.iter().map(|w| w.label.clone()));

            let handle = app.handle();
            let restoring = args.initial_path.is_none() && !session.windows.is_empty();
            if restoring {
                for w in &session.windows {
                    pmd_app_lib::build_window(handle, &w.label, Some(&w.geometry))?;
                }
                if let Some(focus) = &session.focused_label {
                    if let Some(win) = app.get_webview_window(focus) {
                        let _ = win.set_focus();
                    }
                }
            } else {
                pmd_app_lib::build_window(handle, "main", None)?;
            }

            pmd_app_lib::preview::grants::init_grant_store(app.asset_protocol_scope());
            match pmd_app_lib::preview::trust_roots::init_trust_root_store(
                pmd_app_lib::preview::trust_roots::trust_root_settings_path(),
            ) {
                Ok(()) => {}
                Err(e) => eprintln!("[btr-md] could not load trusted asset roots: {e}"),
            }
            // The watcher + registry entry for the initial file are created by
            // the frontend's open flow; here we only nudge it to open.
            if let Some(ref p) = args.initial_path {
                let _ = app.emit("open-file", p.to_string_lossy().to_string());
            }
            // Re-admit the persisted file-browser base directory (a previously
            // user-trusted folder) so the browser tab works after a restart.
            if let Some(base) = pmd_app_lib::state::settings::load().browser_base_dir {
                if let Err(e) = app.state::<AppState>().scope.allow_dir(&base) {
                    eprintln!(
                        "[btr-md] could not re-admit browser base {}: {e}",
                        base.display()
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running btr-md");
}
