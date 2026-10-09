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
In game: 38 (red part textures) -> the trunk/rear turned literally red: a part texture is the part's own
colour. 39 (no part textures) -> rear white and repaintable. Still dark in both: the front of the hood /
nose and the lower sides (38 did not turn them red: those part files may not be drawn at all).
Builds now write no part textures (writeCar partTextures=false); the checker warns about part textures.
40_canyon_part_colors_diagnostic.zip  39 with one solid colour per part folder (frontbumper red, headlight
                         green, rearbumper blue, rearlight yellow, skirt magenta, grill cyan, hood orange,
                         roof purple) to see which part files the game draws and where.
gtv98 study: body/roof have a glass piece (kind 1) drawn see-through; its UVs are a real unwrap over the
whole 1024 texture (decals in the shop use it); its mask: body red (slot 1), lower trim/bumpers green (slot 2),
hood blue (slot 3); rearlight has lamp pieces kind 4 / kind 3. New 'template' layout: gtv98 is bent onto the
new car and every point takes gtv98's UV at the closest spot (same file, same kind), glass goes into the kind-1
piece, lamps into kind 3/4, the template's own textures are used (whole-red mask with paintAll), 1–2 texel nudge
against flat UVs. Windows the model filed as "lights" (above 60 % of the height) are glass now.
41_canyon_gtv98_layout_glass_paintall.zip  pack 35 shape, gtv98 layout, see-through glass, gtv98 part textures, all slot 1
42_canyon_gtv98_layout_no_part_textures.zip  same without part textures
43_canyon_gtv98_layout_gtv98_paint.zip  same with gtv98's own mask (3 colour slots like gtv98)
In game 41: decals work, glass see-through (driver visible). Black / see-through patches remain: gtv98's part
textures (about half alpha 0, half dark brown) drawn as the parts' own colour. -> 42 (no part textures).
Web default now: template layout without part textures (⚡ button, builder, Studio export).
In game 42 = 43 except the headlights (blue in 43 = gtv98's headlight texture): the dark areas are not the mask
nor the part textures. Likely frontbumper / headlight / skirt are not drawn (38's red frontbumper texture never
showed). 44_canyon_front_into_hood.zip: 42 with frontbumper + headlight geometry in the hood file and the skirt in
the roof file (files known to draw); those part folders keep stand-ins only (mesh file set = gtv98's).

In game 40 (one colour per part folder): the front (frontbumper / headlight / grill) and the lower sides
(skirt) stayed dark grey, none of their colours showed: those files are not drawn with the car's paint.
44 (the same geometry moved into hood / roof) came out white and repaintable at the front.
-> Builds in the template layout now put frontbumper / headlight / grill geometry into hood and skirt into
roof automatically (convert INTO_DRAWN, also in writeCar for Studio / old-body builds); the checker warns
when those files still hold geometry.
44 door area dark / see-through (no decal equipped): geometry and normals there are identical to 39 (door
white). Differences: 44 uses gtv98's body detail layer (_color: its orange plate, black and grey swatches)
and 16-33 % of its triangles have copied UVs that cross a gtv98 seam, smearing that layer over the car;
39/40 had a transparent detail layer.
45_canyon_clear_detail_layer.zip  44 with the transparent detail layer of 39 (only _color.png/_color_s.dds differ).
Builds in the template layout now write the transparent detail layer.

zombie1 (a car from the game, 2026-10-10) studied against gtv98:
- Same file names / list.xml form, but one variant per part (default only) and no icon folder;
  headlight / rearlight also hold base_0..2.0m (lamp housings, not named in list.xml).
- Its moving pieces differ from gtv98's (body: doors [0,1,0] / [0,1,1], trunk [0,1,4]): each car its own set,
  matching its dooropen/default.xml (doors 0, 1, 2).
- Every part file has geometry and its own texture (grill even carries pieces along the whole car), so the
  game does draw those files.
- Textures: every .png has an _s.dds at HALF its size with a full mip chain (base 512 png / 256 dds, color
  256x128 / 128x64, parts 128 / 64...), all DXT3. gtv98's dds are the png's size without mips (only its
  color layer is half + mips). "_s" = small copy; both layouts are games' own.
- Part textures and the body _color layer are detail overlays: dark grime / lamp art in RGB, alpha 0..~60
  mostly (mean alpha 8-60): low alpha lets the paint show; lamps are opaque where the lamp art is.
- _base = paint mask: red slot 1 over most, green strips (slot 2), a blue block (slot 3); alpha 199-255.
- Lamps map into their part texture's lamp art (headlight uv 0.50-0.75 x 0.75-0.87).

In game 45 (44 with a transparent colour layer): doors / rear quarter still black. Not the colour layer.
In game 43 (gtv98 3-slot mask): slot 1 / 2 / 3 colours show like gtv98, black / see-through patches remain.
Cause found: gtv98's body file has no door at all (its UV sheet has an empty band between the front and
rear quarters): gtv98's doors are in its roof file. Our doors sat in the body file, took UVs from the
nearest body pieces (sills, small inner islands) and 16-33 % of triangles stretched across the texture.
-> Template layout now: the template is bent onto the car first and every triangle goes into the file the
   template has at that spot (doors → roof), then UVs are copied from that file; a triangle whose corners
   still land on different islands gets its own corners mapped through one template triangle.
   Stretched UVs: 16-33 % → 0.2 %.
46_canyon_files_like_gtv98.zip  pack 35 shape, every piece in gtv98's file for that spot, gtv98's 3-slot
                         mask and colour layer (like 43), tail lamps polestar1-style (below).

polestar1 (a high-poly car from the game, 2026-10-10):
- body_2.0m 52,684 points in one file (pieces up to 30,068), roof 22,000+, every LOD file identical (0 = 1 = 2).
- Doors (moving pieces [0,1,0] / [0,1,1], door glass [1,1,0] / [1,1,1]) are in the roof file, like gtv98's doors.
- Flat UVs everywhere (17,706 body points on one texel, all glass on one texel): fine because the texel is
  red in _base. What matters is the mask colour under the UV, not the UV spread.
- _base 512: red with a green / blue band; _color 128x64 fully opaque dark cabin art (seats, wheel).
- Textures: "_s" copies are .png (no .dds at all) the same size as the png.
- Headlight: a kind 2 lens piece (1,754 points) + the housing (kind 0); the list names polestar1_headlight but
  the file is mclaren_headlight.png → no part texture, painted from the mask.
- Rear light: the lamp shape three times: kind 0 (housing), kind 3 (brake / tail) and kind 4 (indicator),
  same 16,107 points each; the game lights kinds 3 / 4. Builds now do the same with the tail lamps.
In game 46: doors white now (they are in the roof file like gtv98's); jagged black triangles remain on the
rear deck / quarters / door edges. Their normals and windings are fine. Their UVs: corners taken from
different gtv98 islands so the triangle's middle lies on empty texture between islands (body 5 %, roof 9 %,
rearbumper 16 % of triangles in 46; 45: 17 / 24 / 21 %).
47_canyon_uv_on_islands.zip  46 + every triangle whose UV middle or edge middles fall off gtv98's islands
                         remapped through one gtv98 triangle (inside it): body 0.4 %, roof 2 %, rearbumper 3.5 %.
In game 47: still jagged black triangles on the rear deck / quarters / door edges (fewer than 45, about like 46).
Packs 39 / 40 (own zone-column UVs and mask) never showed those triangles: only the front and lower sides
were dark there (fixed in 44 by moving them into hood / roof).
48_canyon_like_40_all_white.zip  39/40's way (own UV columns, own mask, whole car on the paint column,
                         no part textures) + pieces in gtv98's files (doors in roof) + front / grill /
                         headlight geometry in hood, skirt in roof + see-through glass (kind 1 piece).
                         No gtv98 UV unwrap, so shop decals won't land like on gtv98.
In game 48: the whole car white and repainted by one colour slot, no jagged triangles. Still black: one
straight line all around the car at about 0.45 m and below, and the nose of the hood; glass fully clear.
Those are exactly the faces whose zone UVs had v below ~0.33 (side faces: v from the height, top faces: v
from the length). gtv98's windows sit on red in its mask (mask avg 255,0,0 under its glass UVs); ours on black.
49_canyon_48_fixed_low_and_glass.zip  48 with every UV in v 0.40-0.97 (actual 0.52-0.81) and the glass
                         column red in the mask like gtv98's windows.
In game 49: white all over including the nose and the lower sides; the rear deck black (its UVs v 0.75-0.81)
and the glass milky white (glass on red mask, colour layer rgb 0).
50_canyon_49_fixed_deck_and_glass.zip  49 with every UV in v 0.42-0.70 (the band that came out white) and the
                         colour layer under the glass column at gtv98's value under its windows (56,59,59, a 0).
In game 50: white all over, no black anywhere; glass now tinted with the paint; colour 1 repaints everything.
Game cars use three colours (gtv98's mask: red body, green trim, blue hood), all white at first.
51_canyon_three_colours.zip  50 with three colours like gtv98: colour 1 (red) body + glass, colour 2 (green)
                         the model's trim / plastic / chrome materials, colour 3 (blue) the paint where gtv98
                         has its hood. The web's ⚡ build now does 50 / 51 (choice: three colours or one colour
                         for the whole car, McQueen-like); rc_mcqueen rebuilt with one colour.
Escarabajo in the garage (video 2026-10-10): starts white; colour 1 the body / roof / rear deck, colour 2 the
lower band all around (sills, lower bumpers), colour 3 the front lid only; vents / grilles stay black.
52_canyon_colours_like_escarabajo.zip  colour per point from gtv98's own mask (its green lower band → colour 2,
                         its blue hood → colour 3, the rest colour 1), smoothed by neighbour vote; the model's
                         trim / grille / chrome / plastic materials black (no garage colour). The ⚡ build
                         does the same with "three colours".
In game 52: the three colours like Escarabajo (kept). A shop decal turns the car a flat beige: the zone UVs
squeeze the whole car into one thin column of the texture, so the decal shows one spot of itself.
Decals (and maybe film / plate items) need UVs spread over the texture like gtv98's; that layout gave the black
triangles (packs 44-47) whose cause is still open.
53_canyon_uv_ruler_diagnostic.zip  diagnostic: 52's car with every paint piece spread over the whole texture
                         (u along the car; v by height on the sides, 0 at the roof; across the car on top
                         faces) and a mask of 4x4 cells coloured colour 1 / 2 / 3 in turn. With colour 1 red,
                         2 green, 3 blue the car should look like 53_expected.png; cells that come out black or
                         wrong show which parts of the texture the game does not use that way. Also try a decal.
In game 53 (unpainted): white, a black strip with a patch in the wheels' colour (lime) along the shoulders
(where a triangle's corners took the side and the top projection: stretched UVs). With a decal: the decal
pattern spread over the whole car — decals work once the UVs spread over the texture.
=> Black / "wheel picture" areas are triangles whose UVs stretch across the texture (packs 44-53), not the textures.
54_canyon_atlas_decals_three_colours.zip  "atlas" layout: every triangle projected by its own face direction into
                         its own region (left side, right side, top, front, rear; points split where regions meet,
                         0 stretched triangles), mask drawn triangle by triangle with 52's colour slots
                         (body 1, lower band 2, hood 3, trim black), glass / trim / lamps on flat points in a
                         reserved strip, colour layer clear except gtv98's under-window value under the glass point.
