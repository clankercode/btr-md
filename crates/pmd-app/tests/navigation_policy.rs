#[test]
fn navigation_policy_denies_document_external_urls() {
    let external = "https://example.com/escape".parse().unwrap();
    let app_shell = "tauri://localhost/index.html".parse().unwrap();
    let gate = pmd_app_lib::navigation_policy::NavigationGate::new(app_shell);

    assert!(!gate.should_allow_navigation(&external));
}

#[test]
fn navigation_policy_allows_only_exact_initial_app_shell_url_once() {
    let app_shell = "tauri://localhost/index.html".parse().unwrap();
    let gate = pmd_app_lib::navigation_policy::NavigationGate::new(app_shell);

    let exact = "tauri://localhost/index.html".parse().unwrap();
    let second = "tauri://localhost/index.html".parse().unwrap();
    let with_query = "tauri://localhost/index.html?escape=true".parse().unwrap();
    let localhost = "http://127.0.0.1:4444/escape".parse().unwrap();

    assert!(gate.should_allow_navigation(&exact));
    assert!(!gate.should_allow_navigation(&second));
    assert!(!gate.should_allow_navigation(&with_query));
    assert!(!gate.should_allow_navigation(&localhost));
}

#[test]
fn navigation_policy_matches_the_runtime_tauri_app_shell_url() {
    let app_shell = "tauri://localhost".parse().unwrap();
    let gate = pmd_app_lib::navigation_policy::NavigationGate::new(app_shell);

    let exact = "tauri://localhost".parse().unwrap();
    let index_path = "tauri://localhost/index.html".parse().unwrap();

    assert!(gate.should_allow_navigation(&exact));
    assert!(!gate.should_allow_navigation(&index_path));
}
