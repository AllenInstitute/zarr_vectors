## Zarr Vectors Spec  
This a draft repo exploring what a zarr based stored specification would be for large scale Nd "vector" data formats.
Vectors here means places where the location in a Nd space is represented by the coordinates in that space,
as opposed to most zarr based data where you have a dense array of values, and it is the index into that array which represents space. 
Examples include point clouds, skeletons, streamlines, meshes, tracks over time,etc.


## Statement of Support
This specification was developed as a draft to explore whether a single specification framework could cover a wide array of use cases using zarr,
as the fundamental storage backend technology.  Comments or refinements are welcome if others find this exercise useful, it is being released to spark conversation. 

