use std::collections::HashSet;

pub fn required_palette_keys() -> HashSet<&'static str> {
    [
        "bg",
        "bg_elevated",
        "fg",
        "fg_muted",
        "accent",
        "link",
        "border",
        "selection_bg",
        "selection_fg",
        "focus_ring",
        "caret",
        "scrollbar_thumb",
        "scrollbar_track",
        "inline_code_bg",
        "inline_code_fg",
        "code_block_bg",
        "code_block_fg",
        "code_block_border",
        "blockquote_bar",
        "blockquote_fg",
        "hr",
        "table_header_bg",
        "table_row_alt",
        "table_border",
        "admonition_note",
        "admonition_warn",
        "admonition_tip",
        "kbd_bg",
        "kbd_fg",
        "kbd_border",
        "link_hover",
        "link_visited",
        "image_caption",
    ]
    .into_iter()
    .collect()
}

pub fn optional_palette_keys() -> HashSet<&'static str> {
    [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        // Mermaid node colours are all optional: when a theme omits them,
        // `set_theme` derives readable defaults from the core palette (node
        // fill from `bg_elevated`, label from `fg`, borders/lines from
        // `border`/`fg_muted`). A theme may set any of these to override the
        // derived default.
        "mermaid_primary",
        "mermaid_primary_text",
        "mermaid_primary_border",
        "mermaid_secondary",
        "mermaid_tertiary",
        "mermaid_line",
        "mermaid_edge_label_bg",
        "mermaid_cluster_bg",
        "mermaid_note_bg",
        "mermaid_note_border",
        "mermaid_actor_bg",
        "mermaid_error",
    ]
    .into_iter()
    .collect()
}

pub fn required_syntax_keys() -> HashSet<&'static str> {
    [
        "keyword",
        "string",
        "number",
        "function",
        "type",
        "comment",
        "operator",
        "punctuation",
        "variable",
        "constant",
    ]
    .into_iter()
    .collect()
}
