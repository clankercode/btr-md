use pmd_app_lib::{cli, path_scope::PathScope};
use std::path::Path;
use std::process::Command;

#[test]
fn parse_args_recognizes_harness_flags() {
    let scope = PathScope::new();

    let parsed = cli::parse_args(["--list-themes", "--open-dialog"], &scope);

    assert!(parsed.list_themes);
    assert!(parsed.open_dialog);
    assert_eq!(parsed.initial_path, None);
}

#[test]
fn parse_args_still_admits_single_initial_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("hello.md");
    std::fs::write(&path, "# Hello").expect("write markdown");
    let scope = PathScope::new();

    let parsed = cli::parse_args([path.to_string_lossy().to_string()], &scope);

    assert_eq!(parsed.initial_path, Some(path.canonicalize().unwrap()));
    assert!(!parsed.list_themes);
    assert!(!parsed.open_dialog);
    assert_eq!(parsed.render_input, None);
    assert_eq!(parsed.render_output, None);
    assert!(!parsed.standalone);
}

#[test]
fn parse_args_recognizes_render_flag() {
    let scope = PathScope::new();

    let parsed = cli::parse_args(["--render", "in.md"], &scope);

    assert_eq!(parsed.render_input.as_deref(), Some(Path::new("in.md")));
    assert_eq!(parsed.render_output, None);
    assert!(!parsed.standalone);
    // Render mode never admits an initial window path.
    assert_eq!(parsed.initial_path, None);
}

#[test]
fn parse_args_render_with_output_and_standalone() {
    let scope = PathScope::new();

    let parsed = cli::parse_args(
        ["--render", "in.md", "--output", "out.html", "--standalone"],
        &scope,
    );

    assert_eq!(parsed.render_input.as_deref(), Some(Path::new("in.md")));
    assert_eq!(parsed.render_output.as_deref(), Some(Path::new("out.html")));
    assert!(parsed.standalone);
    assert_eq!(parsed.initial_path, None);
}

#[test]
fn parse_args_render_accepts_equals_form() {
    let scope = PathScope::new();

    let parsed = cli::parse_args(["--render=in.md", "--output=out.html"], &scope);

    assert_eq!(parsed.render_input.as_deref(), Some(Path::new("in.md")));
    assert_eq!(parsed.render_output.as_deref(), Some(Path::new("out.html")));
    assert_eq!(parsed.initial_path, None);
}

#[test]
fn render_flag_rejects_missing_value_before_next_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_btr-md"))
        .args(["--render", "--output", "out.html"])
        .output()
        .expect("run btr-md");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--render requires a path argument"));
}

#[test]
fn output_flag_requires_render_mode() {
    let output = Command::new(env!("CARGO_BIN_EXE_btr-md"))
        .args(["--output", "out.html"])
        .output()
        .expect("run btr-md");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--output requires --render"));
}

#[test]
fn render_mode_rejects_extra_positional_path() {
    let output = Command::new(env!("CARGO_BIN_EXE_btr-md"))
        .args(["--render", "in.md", "extra.md"])
        .output()
        .expect("run btr-md");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--render accepts exactly one input path"));
}

#[test]
fn render_mode_rejects_duplicate_render_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_btr-md"))
        .args(["--render", "one.md", "--render", "two.md"])
        .output()
        .expect("run btr-md");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--render may only be provided once"));
}

#[test]
fn render_markdown_to_html_emits_sanitized_fragment() {
    let html = cli::render_markdown_to_html("# Title\n\nHello **world**\n", false);

    // Fragment mode: no document wrapper.
    assert!(!html.contains("<!DOCTYPE html>"));
    assert!(html.contains("Title"));
    assert!(html.contains("<strong>world</strong>"));
}

#[test]
fn render_markdown_to_html_strips_dangerous_html() {
    let html = cli::render_markdown_to_html("Hi\n\n<script>alert(1)</script>\n", false);

    // Strict sanitizer drops scripts.
    assert!(!html.contains("<script"));
    assert!(!html.contains("alert(1)"));
}

#[test]
fn render_markdown_to_html_standalone_wraps_document() {
    let html = cli::render_markdown_to_html("# Hi\n", true);

    assert!(html.starts_with("<!DOCTYPE html>"));
    assert!(html.contains("<html lang=\"en\">"));
    assert!(html.contains("<style>"));
    assert!(html.contains("Hi"));
    assert!(html.trim_end().ends_with("</html>"));
}

#[test]
fn run_headless_render_writes_to_output_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let input = temp.path().join("doc.md");
    let output = temp.path().join("doc.html");
    std::fs::write(&input, "# Heading\n\nbody text\n").expect("write input");

    cli::run_headless_render(&input, Some(&output), false).expect("render ok");

    let written = std::fs::read_to_string(&output).expect("read output");
    assert!(written.contains("Heading"));
    assert!(written.contains("body text"));
    assert!(!written.contains("<!DOCTYPE html>"));
}

#[test]
fn run_headless_render_missing_input_errors() {
    let temp = tempfile::tempdir().expect("tempdir");
    let missing = temp.path().join("nope.md");

    let err = cli::run_headless_render(&missing, None, false).unwrap_err();
    assert!(err.contains("failed to read"));
}
