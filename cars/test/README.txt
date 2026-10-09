Every pack unpacks to rc_canyon/; pack it to rc_canyon.jmd as usual.

In game (2026-10-09):
  17 (low-poly shell, detail in the paint mask, <= ~2,000 verts per file)  loads; dark triangle patches
  18 (detailed source, ~25,000 verts per file)                            crash
  19 (detailed source, <= 8,000 verts per file)                           crash
  => the game has a per-file vertex limit between 2,111 (ukbus body, works) and ~8,000.
  The dark patches: the game lights per vertex, and our shell's vertex normals differ a lot across
  each triangle (28% of edges over 30 degrees; gtv98 has 14%).

20_flat_shading.zip     normals smooth only across edges under 25 degrees: flat, evenly lit facets
                        (5.8 degrees mean edge angle), <= 2,000 verts per file. Built with --normals flat.
21_more_poly_3800.zip   smooth normals, <= 3,800 verts per file (smaller triangles; also probes the limit)
17_full_mask_textures.zip  loads, with the patches
OK_gtv98_as_rc_canyon.zip  gtv98 renamed: the working base
