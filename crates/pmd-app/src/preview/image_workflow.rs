#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageInsertDestination {
    ImagesDirectory,
    ImagesDirectoryForDocumentStem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageInsertReadiness {
    Ready { destination: ImageInsertDestination },
    RequiresSaveBeforeInsert,
}
