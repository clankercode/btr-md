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
        for p in &paths {
            std::process::Command::new(std::env::current_exe().unwrap())
                .arg(p)
                .spawn()
                .ok();
        }
        std::process::exit(0);
    }

    let p = paths.remove(0);
    let _ = scope.allow(&p);
    InitialOpen { path: Some(p) }
}
