use pmd_core::emit;

fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn golden_one(dir: &str, name: &str) {
    let md = std::fs::read_to_string(format!("../../tests/golden/{dir}/{name}.md")).unwrap();
    let want =
        std::fs::read_to_string(format!("../../tests/golden/{dir}/{name}.expected.html")).unwrap();
    let got = emit::render_string(&md);
    assert_eq!(normalize(&got.html), normalize(&want), "{dir}/{name}");
}

#[test]
fn basic_paragraph() {
    golden_one("basic", "01-paragraph");
}

fn list_fixtures() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for dir in [
        "basic", "tables", "lists", "code", "math", "mermaid", "nested",
    ] {
        let d = format!("../../tests/golden/{dir}");
        if let Ok(entries) = std::fs::read_dir(&d) {
            for f in entries.flatten() {
                let name = f.file_name().into_string().unwrap();
                if let Some(stem) = name.strip_suffix(".md") {
                    out.push((dir.to_string(), stem.to_string()));
                }
            }
        }
    }
    out
}

#[test]
fn all_goldens() {
    for (d, n) in list_fixtures() {
        golden_one(&d, &n);
    }
}
