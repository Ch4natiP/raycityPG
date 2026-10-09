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
33_canyon_fixed.zip      the user's canyon_1.zip: the folder had been renamed to canyon but every file and
                         list.xml still said rc_phoenix445 (the game looks for canyon_*); renamed + flat
                         UVs spread (the page's 🔧 repair button). Same files as gtv98.
In game: 33 drives and repaints (body white = the chosen colour). Hood came out brown, roof black: gtv98's
hood / roof / spoiler list.xml names a texture that does not exist on purpose (those parts are then painted
like the body); our transparent stand-ins there were drawn instead. Builds now write only the template's own
textures; 27, 29-32 had those 14 extra files removed.
34_canyon_paint_parts.zip  33 without the extra part textures (file set = gtv98's)
In game 34: repaints (blue), but black areas stay black, wheels off, car too wide (2.30 m; gtv98 1.78).
35_canyon_narrow_wheels_paintall.zip  34 × 0.78 in width, moved 11 cm back so its arches (-1.34 / +1.04)
                         sit on the game's wheels (-1.23 / +1.15), mask: every zone paint except glass/lamps
36_canyon_all_in_body.zip  35 with every part's stock geometry merged into the body (4,989 verts), parts
                         left as stand-ins: in case the separate part files don't take the paint
In game 35 = 36 visually: lower sides / trunk / hood stay black-brown whatever the mask says. Region map:
the black areas are in the PART files (frontbumper over the hood, rearbumper/rearlight over the trunk,
skirt low on the sides) or in body triangles of the plastic zone; body paint-zone triangles are white.
36's hood/arch had holes (merge + reduction dropped small pieces).
37_canyon_all_paint_column.zip  35 with every UV outside glass/lamps/cabin in the paint column (zone 0)
38_canyon_red_part_textures.zip 37 + part textures opaque red (does a part use its own texture as mask?)
39_canyon_no_part_textures.zip  37 + part textures removed (like gtv98's hood/roof, painted like the body)
Web: '⚡ สร้าง + ตรวจ + ดาวน์โหลด' one-click build (raw outer surface ≤4,800/file, wheels fitted, paint
column for everything but glass/lamps, check + repair, download).
