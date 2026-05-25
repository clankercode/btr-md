use std::path::PathBuf;

pub struct InitialOpen {
    pub path: Option<PathBuf>,
}

pub fn parse_argv(scope: &crate::path_scope::PathScope) -> InitialOpen {
    let args = std::env::args().skip(1).peekable();
    let mut paths: Vec<PathBuf> = args
        .filter(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .collect();

    if paths.is_empty() {
        return InitialOpen { path: None };
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
        Ok(canon) => InitialOpen { path: Some(canon) },
        Err(e) => {
            eprintln!("ignoring initial path {}: {}", p.display(), e);
            InitialOpen { path: None }
        }
    }
}
