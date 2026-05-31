#[test]
fn asset_grant_csp_allows_data_images_without_widening_asset_scope_by_default() {
    let config_path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../pmd-app/tauri.conf.json");
    let config = std::fs::read_to_string(config_path).expect("read tauri config");
    let json: serde_json::Value = serde_json::from_str(&config).expect("parse tauri config");
    let security = &json["app"]["security"];

    assert!(security["csp"]
        .as_str()
        .expect("csp string")
        .contains("img-src 'self' data:"));
    assert_eq!(
        security["assetProtocol"]["scope"]
            .as_array()
            .expect("asset protocol scope array")
            .len(),
        0
    );
}
