"""Generate the zarr-vectors §14 illustration images.

Run with:
    uv run --with matplotlib --with numpy python images/generate.py
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from mpl_toolkits.mplot3d.art3d import Line3DCollection, Poly3DCollection

OUT = Path(__file__).parent

# Shared palette: muted but distinct (Set2-ish).
PALETTE = [
    "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B2",
    "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD",
]
plt.rcParams["axes.titleweight"] = "bold"
plt.rcParams["axes.titlesize"] = 14
plt.rcParams["savefig.bbox"] = "tight"
plt.rcParams["savefig.dpi"] = 150


def _axes3d(fig, rect=111, title=None):
    ax = fig.add_subplot(rect, projection="3d")
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    ax.set_zlabel("z")
    if title:
        ax.set_title(title)
    ax.set_box_aspect((1, 1, 1))
    return ax


# ---------------------------------------------------------------------------
# 1. Colored point cloud — mouse brain nuclei grouped by region
# ---------------------------------------------------------------------------

def point_cloud() -> None:
    rng = np.random.default_rng(42)
    n_regions = 6
    region_names = [
        "cortex", "hippocampus", "thalamus",
        "striatum", "cerebellum", "midbrain",
    ]
    # Each region is a Gaussian blob at a different center.
    centers = rng.uniform(0.2, 0.8, size=(n_regions, 3))
    spreads = rng.uniform(0.04, 0.10, size=n_regions)
    sizes = rng.integers(500, 1500, size=n_regions)

    fig = plt.figure(figsize=(7, 5.5))
    ax = _axes3d(fig)
    for i in range(n_regions):
        pts = rng.normal(centers[i], spreads[i], size=(sizes[i], 3))
        ax.scatter(
            pts[:, 0], pts[:, 1], pts[:, 2],
            s=5, alpha=0.55, color=PALETTE[i], label=region_names[i],
            edgecolors="none",
        )
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_zlim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])
    ax.set_title("Point cloud · cell nuclei colored by region")
    ax.legend(loc="upper left", fontsize=8, markerscale=2.0,
              framealpha=0.9, ncol=2)
    fig.savefig(OUT / "point_cloud.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# 2. Skeleton — branching tree
# ---------------------------------------------------------------------------

def _grow_skeleton(rng, n_branches=30, n_per_branch=80):
    """Procedurally grow a neuron-like skeleton.

    Returns (vertices, edges) where edges are (parent, child) index pairs.
    """
    vertices = [np.array([0.5, 0.5, 0.5])]
    edges: list[tuple[int, int]] = []
    # Initial soma -> primary branches.
    primary_dirs = rng.normal(size=(n_branches, 3))
    primary_dirs /= np.linalg.norm(primary_dirs, axis=1, keepdims=True)
    branch_starts = []
    for d in primary_dirs:
        # Place each primary branch start a tiny step from the soma.
        v = vertices[0] + 0.02 * d
        parent = 0
        cur = len(vertices)
        vertices.append(v)
        edges.append((parent, cur))
        branch_starts.append((cur, d))

    for start_idx, init_dir in branch_starts:
        cur_dir = init_dir.copy()
        parent = start_idx
        for _ in range(n_per_branch):
            # Bend the direction slightly each step.
            jitter = rng.normal(0, 0.25, size=3)
            cur_dir = cur_dir + jitter * 0.15
            cur_dir /= np.linalg.norm(cur_dir)
            step = 0.012
            new_v = vertices[parent] + step * cur_dir
            cur = len(vertices)
            vertices.append(new_v)
            edges.append((parent, cur))
            parent = cur
            # Occasional secondary branch.
            if rng.uniform() < 0.04 and _ > 5:
                bd = rng.normal(size=3)
                bd /= np.linalg.norm(bd)
                # Grow a short branchlet
                bparent = cur
                for _b in range(rng.integers(8, 20)):
                    bd = bd + rng.normal(0, 0.2, size=3) * 0.15
                    bd /= np.linalg.norm(bd)
                    nv = vertices[bparent] + step * bd
                    nc = len(vertices)
                    vertices.append(nv)
                    edges.append((bparent, nc))
                    bparent = nc
    return np.array(vertices), edges


def skeleton() -> None:
    rng = np.random.default_rng(11)
    verts, edges = _grow_skeleton(rng)

    segs = np.array([[verts[p], verts[c]] for p, c in edges])
    # Color edges by distance from soma (depth in tree).
    depths = np.linalg.norm(segs.mean(axis=1) - np.array([0.5, 0.5, 0.5]),
                            axis=1)
    fig = plt.figure(figsize=(7, 5.5))
    ax = _axes3d(fig)
    lc = Line3DCollection(segs, cmap="viridis", linewidths=0.8, alpha=0.9)
    lc.set_array(depths)
    ax.add_collection3d(lc)
    # Soma marker
    ax.scatter([0.5], [0.5], [0.5], s=80, color="#C44E52",
               edgecolor="black", linewidth=0.5, label="soma", zorder=10)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_zlim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])
    ax.set_title("Skeleton · neuronal tree with branch points")
    cbar = fig.colorbar(lc, ax=ax, shrink=0.55, pad=0.08)
    cbar.set_label("distance from soma", fontsize=9)
    ax.legend(loc="upper left", fontsize=9)
    fig.savefig(OUT / "skeleton.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# 3. Mesh — surface with triangle faces, multi-resolution hint
# ---------------------------------------------------------------------------

def _torus_mesh(n_u=40, n_v=20, R=0.35, r=0.12):
    u = np.linspace(0, 2 * np.pi, n_u, endpoint=False)
    v = np.linspace(0, 2 * np.pi, n_v, endpoint=False)
    uu, vv = np.meshgrid(u, v, indexing="ij")
    x = (R + r * np.cos(vv)) * np.cos(uu) + 0.5
    y = (R + r * np.cos(vv)) * np.sin(uu) + 0.5
    z = r * np.sin(vv) + 0.5
    verts = np.stack([x.ravel(), y.ravel(), z.ravel()], axis=-1)
    faces: list[tuple[int, int, int]] = []
    for i in range(n_u):
        for j in range(n_v):
            i1 = (i + 1) % n_u
            j1 = (j + 1) % n_v
            a = i * n_v + j
            b = i1 * n_v + j
            c = i1 * n_v + j1
            d = i * n_v + j1
            faces.append((a, b, c))
            faces.append((a, c, d))
    return verts, np.array(faces)


def mesh() -> None:
    fig = plt.figure(figsize=(11, 5))

    # Left: fine mesh
    v_fine, f_fine = _torus_mesh(60, 30)
    ax1 = _axes3d(fig, rect=121, title="Mesh · fine resolution")
    tris = v_fine[f_fine]
    colors = (tris[:, :, 2].mean(axis=1) - 0.4) / 0.2  # color by z
    poly = Poly3DCollection(
        tris, facecolors=plt.cm.plasma(colors),
        edgecolors="#222", linewidths=0.15, alpha=0.95,
    )
    ax1.add_collection3d(poly)
    for ax in (ax1,):
        ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_zlim(0, 1)
        ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])

    # Right: coarse mesh (lower resolution level)
    v_coarse, f_coarse = _torus_mesh(20, 10)
    ax2 = _axes3d(fig, rect=122, title="Mesh · coarse pyramid level")
    tris = v_coarse[f_coarse]
    colors = (tris[:, :, 2].mean(axis=1) - 0.4) / 0.2
    poly = Poly3DCollection(
        tris, facecolors=plt.cm.plasma(colors),
        edgecolors="#222", linewidths=0.5, alpha=0.95,
    )
    ax2.add_collection3d(poly)
    ax2.set_xlim(0, 1); ax2.set_ylim(0, 1); ax2.set_zlim(0, 1)
    ax2.set_xticks([]); ax2.set_yticks([]); ax2.set_zticks([])

    fig.savefig(OUT / "mesh.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# 4. Streamlines — DTI tracts
# ---------------------------------------------------------------------------

def _streamline_bundle(rng, n_lines, start_jitter, control_offset,
                       end_jitter, n_pts=60, twist=0.0):
    """Generate n_lines smooth curves from one cluster to another."""
    out: list[np.ndarray] = []
    for _ in range(n_lines):
        s = start_jitter + rng.normal(scale=0.025, size=3)
        e = start_jitter + control_offset + rng.normal(scale=0.025, size=3)
        c = (s + e) / 2 + rng.normal(scale=0.10, size=3)
        c[2] += 0.15  # arch upward
        t = np.linspace(0, 1, n_pts)
        # Quadratic Bézier
        pts = (
            (1 - t)[:, None] ** 2 * s
            + 2 * (1 - t)[:, None] * t[:, None] * c
            + t[:, None] ** 2 * e
        )
        if twist != 0:
            theta = twist * t
            rot = np.stack([
                np.cos(theta), -np.sin(theta), np.zeros_like(theta),
                np.sin(theta), np.cos(theta), np.zeros_like(theta),
                np.zeros_like(theta), np.zeros_like(theta), np.ones_like(theta),
            ], axis=-1).reshape(-1, 3, 3)
            center = pts.mean(axis=0)
            pts = (pts - center) @ rot[0] + center
        out.append(pts)
    return out


def streamlines() -> None:
    rng = np.random.default_rng(7)
    bundles: list[tuple[str, list[np.ndarray], str]] = [
        (
            "arcuate fasciculus",
            _streamline_bundle(rng, 90, np.array([0.2, 0.2, 0.3]),
                                np.array([0.6, 0.4, 0.0]), 0.02),
            "#4C72B0",
        ),
        (
            "corticospinal",
            _streamline_bundle(rng, 70, np.array([0.5, 0.6, 0.85]),
                                np.array([0.0, -0.2, -0.7]), 0.02),
            "#DD8452",
        ),
        (
            "callosal",
            _streamline_bundle(rng, 60, np.array([0.15, 0.5, 0.55]),
                                np.array([0.7, 0.0, 0.0]), 0.02),
            "#55A868",
        ),
        (
            "uncinate",
            _streamline_bundle(rng, 50, np.array([0.3, 0.3, 0.6]),
                                np.array([0.3, 0.4, -0.1]), 0.02),
            "#8172B2",
        ),
    ]
    fig = plt.figure(figsize=(7, 5.5))
    ax = _axes3d(fig)
    for name, lines, color in bundles:
        segs = []
        for line in lines:
            segs.extend([(line[i], line[i + 1]) for i in range(len(line) - 1)])
        lc = Line3DCollection(segs, colors=color, linewidths=0.6, alpha=0.55)
        ax.add_collection3d(lc)
        # add invisible 2D legend proxy
        ax.plot([], [], [], color=color, label=name, linewidth=3)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_zlim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])
    ax.set_title("Streamlines · DTI tracts grouped into bundles")
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    fig.savefig(OUT / "streamlines.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# 5. Tracks over time — XYZT particle trails
# ---------------------------------------------------------------------------

def tracks_xyzt() -> None:
    rng = np.random.default_rng(3)
    n_tracks = 30
    n_steps = 40
    # Each track wanders in 3D over time.
    tracks: list[np.ndarray] = []
    for _ in range(n_tracks):
        start = rng.uniform(0.1, 0.9, size=3)
        # Smooth drift via low-pass-filtered noise.
        raw = rng.normal(scale=0.02, size=(n_steps, 3))
        # Cumulative + light damping
        path = np.cumsum(raw, axis=0) * 0.6 + start
        # Time channel
        t = np.linspace(0, 1, n_steps)
        tracks.append(np.column_stack([path, t]))

    fig = plt.figure(figsize=(7, 5.5))
    ax = _axes3d(fig)
    # Color each segment by time.
    cmap = plt.cm.viridis
    for trk in tracks:
        pts = trk[:, :3]
        ts = trk[:, 3]
        segs = np.stack([pts[:-1], pts[1:]], axis=1)
        lc = Line3DCollection(segs, cmap=cmap, linewidths=1.0, alpha=0.85)
        lc.set_array((ts[:-1] + ts[1:]) / 2)
        ax.add_collection3d(lc)
        # Mark final position
        ax.scatter([pts[-1, 0]], [pts[-1, 1]], [pts[-1, 2]],
                   s=18, color=cmap(ts[-1]), edgecolor="black",
                   linewidth=0.3, zorder=10)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_zlim(0, 1)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])
    ax.set_title("Tracks over time · particle paths in XYZT")
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(0, 1))
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, shrink=0.55, pad=0.08)
    cbar.set_label("time (normalized)", fontsize=9)
    fig.savefig(OUT / "tracks_xyzt.png")
    plt.close(fig)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    point_cloud()
    skeleton()
    mesh()
    streamlines()
    tracks_xyzt()
    print("Wrote:", sorted(p.name for p in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
