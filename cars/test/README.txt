Every pack unpacks to rc_canyon/; pack it to rc_canyon.jmd as usual.

In game (2026-10-09): 17 and 21 load (21 up to 3,631 verts per file); 18 (25k) and 19 (8k) crash.
The dark triangle patches in 17/21: the game reads the paint mask per vertex (the original cars' masks are
flat color blocks), so a baked, detailed mask turns into triangle patches.

28_old_body_bent.zip     gtv98 (works in game) bent into the Urus shape: every file has gtv98's structure
                         and vertex counts, only the points moved (safest)
25_limit_4000.zip        Urus shell, every file at most 4,000 verts (body 3,927)  } finding the game's
26_limit_4500.zip        same at most 4,500 (body 4,353)                           } real per-file limit
27_limit_6000.zip        same at most 6,000 (body 5,825)                           } (3,631 loads, 8,000 crashes)
24_urus_no_reduce.zip    Urus, the model's own surface, no reduction (body 19,667): expected to crash
23_urus_from_web.zip     Urus shell, 3,500 per file
22_flat_colors_3500.zip  every triangle samples one flat mask cell for its material (paint red, rest
                         black), like the original cars; at most 3,500 verts per file (--colors palette)
old/21_more_poly_3800.zip  loads (limit is above 3,631)
old/17_full_mask_textures.zip  loads
OK_gtv98_as_rc_canyon.zip  gtv98 renamed: the working base
