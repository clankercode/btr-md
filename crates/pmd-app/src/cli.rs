use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedArgs {
    pub initial_path: Option<PathBuf>,
    pub list_themes: bool,
    pub open_dialog: bool,
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

    for arg in args {
        match arg.as_ref() {
            "--list-themes" => list_themes = true,
            "--open-dialog" => open_dialog = true,
            other if other.starts_with("--") => {}
            path => paths.push(PathBuf::from(path)),
        }
    }

    if paths.is_empty() {
        return ParsedArgs {
            initial_path: None,
            list_themes,
            open_dialog,
        };
    }

    if list_themes {
        return ParsedArgs {
            initial_path: None,
            list_themes,
            open_dialog,
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
    match scope.allow(&p) {
        Ok(canon) => ParsedArgs {
            initial_path: Some(canon),
            list_themes,
            open_dialog,
        },
        Err(e) => {
            eprintln!("ignoring initial path {}: {}", p.display(), e);
            ParsedArgs {
                initial_path: None,
                list_themes,
                open_dialog,
            }
        }
    }
}

pub fn print_theme_list() -> Result<(), String> {
    let themes =
        crate::cmd::theme::list_themes_from_roots(&crate::cmd::theme::find_theme_roots(None))?;
    for theme in themes {
        println!("{}\t{}", theme.slug, theme.name);
    }
    Ok(())
}
