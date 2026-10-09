Every pack unpacks to rc_canyon/; pack it to rc_canyon.jmd as usual.

Known (2026-10-09): every file type we write loads in game; the earlier crashes went away with gtv98
as the template (no door animation) and 8-vertex stand-in boxes instead of single triangles.

18_highpoly_full.zip   the original detailed GMC model, wheels removed (~20k triangles per file, 3 LODs),
                       laid out like gtv98, glass/lamp submeshes kept, colors through the paint mask
                       (paint = red cell, everything else black). Built with --raw --mask.
19_highpoly_mid.zip    the same, at most 8,000 vertices per file (if 18 crashes or stutters)
17_full_mask_textures.zip  the low-poly shell with detail baked into the paint mask (= cars/rc_canyon.zip)
OK_gtv98_as_rc_canyon.zip  gtv98 renamed: the working base. Older packs are in the git history.
