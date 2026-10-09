Every pack unpacks to rc_canyon/; pack it to rc_canyon.jmd as usual.

In game (2026-10-09): 17 and 21 load (21 up to 3,631 verts per file); 18 (25k) and 19 (8k) crash.
The dark triangle patches in 17/21: the game reads the paint mask per vertex (the original cars' masks are
flat color blocks), so a baked, detailed mask turns into triangle patches.

In game (later): a Studio build with the old top-row mask cells showed the car all black and the garage
could not repaint it. Packs 22-27 were rewritten to full-height mask zones (same shapes).

Later: rc_phoenix445 (body 5,005 verts) LOADS in game -> the per-file limit is above 5,005. It showed
grey see-through and could not be painted: every triangle had all three UVs on one point (100 % flat UV
triangles); gtv98 has 9 %. All our packs now spread UVs inside their mask zones (writeCar / zoneUVs).

32_phoenix445_fixed_uv.zip   the user's rc_phoenix445 with spread UVs + zone mask (flat UV 0.3 %)
30_your_car_spread_uv_all_red.zip  the user's car, UVs spread over the whole mask, mask all red: does
                         the paint work at all with this geometry?
29_your_car_big_paint_zones.zip    the user's car with the new mask zones (16 full-height columns)
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
31_urus_outer_surface_3500.zip  the Urus's own outer surface (hidden interior removed: 84k tris), each
                         file reduced to 3,500 verts, zone mask

old/ also holds 22-26 (rewritten to spread UVs) — moved out of the page to keep it small.
