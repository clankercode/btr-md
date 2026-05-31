use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedArgs {
    pub initial_path: Option<PathBuf>,
    pub list_themes: bool,
    pub open_dialog: bool,
    /// Headless render mode: input markdown file to render via `pmd-core`.
    /// When set, the app renders and exits without creating a Tauri window.
    pub render_input: Option<PathBuf>,
    /// Optional output path for `--render`; `None` means write to stdout.
    pub render_output: Option<PathBuf>,
    /// When true, `--render` emits a self-contained HTML document instead of a
    /// bare sanitized fragment.
    pub standalone: bool,
}

pub fn parse_argv(scope: &crate::path_scope::PathScope) -> ParsedArgs {
    parse_args(std::env::args().skip(1), scope)
}

pub fn parse_args<I, S>(args: I, scope: &crate::path_scope::PathScope) -> ParsedArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut list_themes = false;
    let mut open_dialog = false;
    let mut render_input: Option<PathBuf> = None;
    let mut render_output: Option<PathBuf> = None;
    let mut standalone = false;

    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_ref() {
            "--list-themes" => list_themes = true,
            "--open-dialog" => open_dialog = true,
            "--standalone" => standalone = true,
            value if value.starts_with("--render=") => {
                reject_duplicate(render_input.is_some(), "--render");
                render_input = Some(flag_value("--render", &value["--render=".len()..]));
            }
            value if value.starts_with("--output=") => {
                reject_duplicate(render_output.is_some(), "--output");
                render_output = Some(flag_value("--output", &value["--output=".len()..]));
            }
            "--render" => {
                reject_duplicate(render_input.is_some(), "--render");
                if let Some(value) = iter.next() {
                    render_input = Some(flag_value("--render", value.as_ref()));
                } else {
                    eprintln!("--render requires a path argument");
                    std::process::exit(2);
                }
            }
            "--output" => {
                reject_duplicate(render_output.is_some(), "--output");
                if let Some(value) = iter.next() {
                    render_output = Some(flag_value("--output", value.as_ref()));
                } else {
                    eprintln!("--output requires a path argument");
                    std::process::exit(2);
                }
            }
            other if other.starts_with("--") => {}
            path => paths.push(PathBuf::from(path)),
        }
    }

    if render_input.is_none() && render_output.is_some() {
        eprintln!("--output requires --render");
        std::process::exit(2);
    }

    if render_input.is_some() && !paths.is_empty() {
        eprintln!("--render accepts exactly one input path");
        std::process::exit(2);
    }

    // Headless render mode reads the input file directly (no Tauri window, no
    // path-scope admission of an initial path). Resolve it before the
    // window-oriented path handling below.
    if let Some(input) = render_input {
        return ParsedArgs {
            initial_path: None,
            list_themes,
            open_dialog,
            render_input: Some(input),
            render_output,
            standalone,
        };
    }

    if paths.is_empty() {
        return ParsedArgs {
            initial_path: None,
            list_themes,
            open_dialog,
            render_input: None,
            render_output,
            standalone,
        };
    }

    if list_themes {
        return ParsedArgs {
            initial_path: None,
            list_themes,
            open_dialog,
            render_input: None,
            render_output,
            standalone,
        };
    }

    if paths.len() > 1 {
        let exe = match std::env::current_exe() {
            Ok(e) => e,
            Err(e) => {
                eprintln!("failed to get executable path: {}", e);
                std::process::exit(1);
            }
        };
        for p in &paths {
            if let Err(e) = std::process::Command::new(&exe).arg(p).spawn() {
                eprintln!("failed to spawn instance for {}: {}", p.display(), e);
            }
        }
        std::process::exit(0);
    }

    let p = paths.remove(0);
    // If scoping fails (e.g. the parent directory cannot be canonicalised,
    // typically because the path does not exist), do not advertise the path
    // to downstream open/watch logic — those code paths assume the scope
    // covers it.
    match scope.allow_file_and_parent(&p) {
        Ok(canon) => ParsedArgs {
            initial_path: Some(canon),
            list_themes,
            open_dialog,
            render_input: None,
            render_output,
            standalone,
        },
        Err(e) => {
            eprintln!("ignoring initial path {}: {}", p.display(), e);
            ParsedArgs {
                initial_path: None,
                list_themes,
                open_dialog,
                render_input: None,
                render_output,
                standalone,
            }
        }
    }
}

fn flag_value(flag: &str, value: &str) -> PathBuf {
    if value.is_empty() || value.starts_with("--") {
        eprintln!("{flag} requires a path argument");
        std::process::exit(2);
    }
    PathBuf::from(value)
}

fn reject_duplicate(seen: bool, flag: &str) {
    if seen {
        eprintln!("{flag} may only be provided once");
        std::process::exit(2);
    }
}

/// Render `markdown` to sanitized HTML using the same pure `pmd-core` pipeline
/// that drives the live preview (`render_incremental` → emit → strict
/// sanitizer), returning the sanitized fragment. When `standalone` is true, the
/// fragment is wrapped in a minimal self-contained HTML document.
///
pub fn render_markdown_to_html(markdown: &str, standalone: bool) -> String {
    let result = pmd_core::incremental::render_incremental(markdown);
    if standalone {
        wrap_standalone(&result.html)
    } else {
        result.html
    }
}

/// Minimal self-contained HTML document wrapper around a sanitized fragment.
fn wrap_standalone(fragment: &str) -> String {
    const MINIMAL_CSS: &str = "body{max-width:48rem;margin:2rem auto;padding:0 1rem;\
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}\
pre{overflow:auto;padding:.75rem;background:#f6f8fa;border-radius:6px}\
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}\
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:.4rem .6rem}\
img{max-width:100%}";
    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<title>btr-md</title>\n<style>{MINIMAL_CSS}</style>\n</head>\n<body>\n{fragment}\n</body>\n</html>\n"
    )
}

/// Headless render entry point: read the markdown at `input`, render it via
/// `pmd-core`, and write the result to `output` (or stdout when `None`).
/// Returns a human-readable error message on failure.
pub fn run_headless_render(
    input: &std::path::Path,
    output: Option<&std::path::Path>,
    standalone: bool,
) -> Result<(), String> {
    let markdown = std::fs::read_to_string(input)
        .map_err(|e| format!("failed to read {}: {e}", input.display()))?;
    let html = render_markdown_to_html(&markdown, standalone);
    match output {
        Some(path) => std::fs::write(path, html.as_bytes())
            .map_err(|e| format!("failed to write {}: {e}", path.display()))?,
        None => {
            use std::io::Write;
            std::io::stdout()
                .write_all(html.as_bytes())
                .map_err(|e| format!("failed to write to stdout: {e}"))?;
        }
    }
    Ok(())
}

pub fn print_theme_list() -> Result<(), String> {
    let themes =
        crate::cmd::theme::list_themes_from_roots(&crate::cmd::theme::find_theme_roots(None))?;
    for theme in themes {
        println!("{}\t{}", theme.slug, theme.name);
    }
    Ok(())
}
