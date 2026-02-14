# 10. Cross-Chunk Linking

## 10.1 Problem Statement

- Objects spanning multiple spatial chunks
- Maintaining connectivity across boundaries
- Efficient querying of distributed objects

## 10.2 Strategy 1: Boundary Deduplication

- **Principle**: Vertices on chunk boundaries are explicitly placed
- **Deduplication**: Same vertex appears in adjacent chunks
- **Linking**: Implicit via coordinate matching
- **Advantages**: Simple, efficient for many cases
- **Disadvantages**: Requires precise coordinate alignment, potential inconsistencies

## 10.3 Strategy 2: Explicit Cross-Chunk Links

- **Principle**: Separate array storing inter-chunk connections
- **Format**: `(chunk_coords + vertex_offset, chunk_coords + vertex_offset)`
- **Advantages**: Explicit, no coordinate matching needed
- **Disadvantages**: Additional storage, query complexity

## 10.4 Strategy Selection

- Metadata specifies which strategy is used
- May use both strategies (deduplication + explicit links)
- Use case guidance

## 10.5 Object Index for Cross-Chunk Objects

- Object index array tracks all chunks containing an object
- Efficient object reconstruction
- Query patterns

## 10.6 Consistency Guarantees

- Maintaining link consistency during writes
- Handling concurrent modifications
- Validation requirements






