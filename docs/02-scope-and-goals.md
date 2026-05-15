# 2. Scope and Goals

## 2.1 In Scope

The Zarr Vector Format specification covers:

- Point clouds (2D, 3D, N-dimensional)
- Meshes (triangular, quad, tetrahedral, etc.)
- Skeletons and graphs
- Streamlines and polylines
- Tracks through time
- Spatial transcriptomics (cells and detection points) 
- Arbitrary N-dimensional vector data
- Spatial indexing and multi-resolution
- Distributed read/write operations
- Rich metadata support

## 2.2 Out of Scope

The following are explicitly out of scope for this specification:

- Specific visualization APIs
- Compression algorithm specifications (references existing standards)

## 2.3 Example Use Cases

### Large-Scale Multiplexed FISH with Transcriptome Wide Gene Imputations

This use case demonstrates organizing point clouds via cell-types with genome-wide transcriptome measurements per cell:

- **Organizing point clouds via cell-types**: Cells are organized into groups based on cell type classification
- **Genome-wide transcriptome measurements per cell**: Each cell point has attributes for thousands of genes
- **Write sequence**: 
  - Linking point clouds within a spatial bin to a cell type
  - Writing all groups across spatial bins
- **Group hierarchies**: Using groups to link cell-types into super-groups
- **Read patterns**:
  - Reading all cells that belong to a type
  - Reading all cells that belong to a super-type
  - Reading all cells in a spatial cutout

### Distributed Multi-Resolution Triangular Meshes

This use case demonstrates organizing meshes into spatially divided sections with multi-resolution support:

- **Organizing meshes into spatially divided sections**: Meshes are divided into spatial chunks
- **Writing meshes as Draco compressed byte streams**: Mesh geometry is encoded using Draco compression
- **Fragment index**: a per-chunk fragment index identifies all mesh fragments in each chunk; an object manifest chains fragments across chunks to form whole-mesh objects
- **Read patterns**:
  - Reading all the components of a high resolution mesh
  - Reading sufficient metadata to build an oct-tree representation of a mesh across all levels of detail
  - Facilitating multi-resolution visualization with reads of the mesh data on demand

### Skeleton/Graph Storage for Connectomics

This use case demonstrates storing neuronal skeletons with spatial organization:

- **Breaking skeletons into spatial buckets**: Skeletons are divided into spatial regions
- **Repeating vertices at border** *(optional)*: under `cross_chunk_strategy = "boundary_deduplication"`, vertices on chunk boundaries are duplicated.  The default strategy (`explicit_links`) instead records `cross_chunk_links/0/data` records and keeps vertices unique.
- **Appending vertices and fragment-index entries**: new skeleton fragments can be incrementally added to a chunk without rewriting other chunks
- **Adding parent indices**: parent-child relationships are stored under `links/0/<chunk>` (`link_width = 1`); under `links_convention = "implicit_sequential_with_branches"` only branch links are materialised
- **Adding vertex properties**: Properties like radius and compartment are stored per vertex
- **Reconstructing entire skeleton**: Complete skeletons can be reconstructed from distributed chunks






