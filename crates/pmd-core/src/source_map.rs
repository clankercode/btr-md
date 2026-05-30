use std::ops::Range;

#[derive(Debug, Clone)]
pub struct LineIndex {
    starts: Vec<usize>,
}

impl LineIndex {
    pub fn new(source: &str) -> Self {
        let starts = std::iter::once(0)
            .chain(source.match_indices('\n').map(|(idx, _)| idx + 1))
            .collect();
        Self { starts }
    }

    pub fn byte_to_line(&self, byte: usize) -> u32 {
        self.starts.partition_point(|&start| start <= byte) as u32
    }

    pub fn byte_range_to_lines(&self, range: Range<usize>) -> (u32, u32) {
        let start = self.byte_to_line(range.start);
        let end_byte = range.end.saturating_sub(1).max(range.start);
        (start, self.byte_to_line(end_byte))
    }
}
