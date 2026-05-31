use pulldown_cmark::Options;

pub fn markdown_options() -> Options {
    let mut opts = Options::empty();
    opts.insert(
        Options::ENABLE_TABLES
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_FOOTNOTES
            | Options::ENABLE_HEADING_ATTRIBUTES
            // Recognize leading `---`/`+++` fenced metadata as a frontmatter
            // (MetadataBlock) rather than a thematic break + body text. The
            // block is metadata only: it is surfaced via the inspector panel
            // and deliberately excluded from rendered HTML (see emit.rs). This
            // also keeps a mid-document `---` thematic break rendering normally.
            | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
            | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS,
    );
    opts
}
