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
In game 54: right side, top, front, rear white and clean; the LEFT side all black with patches in the wheels'
colour. The left side was the only region in v 0.02-0.29: the top third of the texture is the game's own
(the wheels' picture), as pack 48 showed (everything mapped below v 0.33 black).
55_canyon_atlas_lower_two_thirds.zip  54 with every region in v 0.35-0.97 (sides 0.37-0.77, top / front / rear
                         0.79-0.97, flat points at 0.35) and clear of the bottom-left corner (u < 0.08, v > 0.69).
In game 55: the sides right (three colours, shop decals); hood / roof / rear deck / front / rear black or other
pictures. Shop decals and films are drawn for the game's UV sheet (gtv98's: sides at the top and bottom, roof in
the middle, hood the blue block), so an own layout puts them in the wrong place.
57_canyon_uv_cut_like_gtv98.zip  "islands" layout: gtv98's own UV sheet, cut like it — every gtv98 island gets a
                         best-fit 3D→UV map over the bent template, each triangle takes the island of the closest
                         template triangle (same file first) and all corners go through that map (corners split
                         where islands meet: 0 stretched triangles); gtv98's mask (three colours where gtv98 has
                         them), trim / grilles / lamps on one black spot in empty texture. 57_uv_vs_gtv98.png
                         shows the sheet next to gtv98's, 57_colours_preview.png the colours.

Escarabajo study (samples/escarabajo.rar, the real car — test3/ was our rc_canyon renamed):
- Glass (kind 1): a real unwrap in its own rectangle u 0-0.125, v 0.25-0.375; mask red there; colour layer
  near black (0-9) with alpha 0 (gtv98 / our packs 50-57: 56,59,59 alpha 0). Builds now put every glass
  piece flat-projected into a free rectangle (Escarabajo's place when free), mask red, colour layer 1,1,1,0.
- Files, default only: every part folder has default_0/1/2.0m (headlight / rearlight also a 'base' mesh),
  textures for frontbumper / headlight / rearbumper / rearlight / skirt (64x64-128x128, dds half size + mips),
  hood / roof list tex='' (painted like the body), mainspoiler has no default (shop wings only),
  icons <name>_<part>_default.png (+ headlight_base / rearlight_base).
  Tail lamp pieces: housing kind 0, brake kind 3 ×2, indicator kind 4 ×2, each on its band of the lamp texture.
- Builds now: list.xml with only the default, variants (rbrc_001...) dropped (mainspoiler kept), a folder
  without a default (gtv98's skirt) gets an empty one, default icons for every folder, the rearlight its own
  texture (dark red housing / red brake / amber indicator bands) when it had none.
- New-body three colours now use our own mask drawn triangle by triangle (sharp borders on panel edges);
  'pickup' colours: colour 1 the whole car, colour 3 the hood, colour 2 the tailgate.
- Three colours on every car now default to body (1) / hood (3, the template's) / tail lid (2: trunk lid top and
  back for a sedan, tailgate only for a pickup); old body: the gtv98 mask's band → colour 1 and the tail lid
  filled green where no other panel shares the texels. Escarabajo's lower band stays as an option.
- RayCity UV: 🖌 paint tool (colour 1 / 2 / 3 / black; click a panel, brush, whole piece, whole car), saves the
  mask; RayCity Easy's 🖌 button opens it with the built car.

Video 2026-10-12 (the user's own car, own UV): white body fine; the hood showed a round wheel-like picture and
the tail lid black-white checkers and colour bars. Every game car's _color.png keeps the same block at its
bottom-left (u < 0.17, v > 0.66: black / purple squares and a black-white ramp); that car's top view (hood,
tail lid) sat in the bottom strip, over that block. RayCity UV now shows the colour layer, marks triangles on a
picture or in the block (purple) and clears the layer except the block; new-body builds clear it too.
Escarabajo (default parts only) is now an embedded template: the guide in RayCity UV and an old-body choice
in RayCity Easy (not tested in game yet).
- New body UV 'charts' (RayCity Easy default now): Escarabajo's way — every panel its own flat piece, no two
  pieces share texture (painting one panel never lands on another), placed where Escarabajo has them (one
  side on top, the other in the lower middle, top view in the middle, front / rear columns, the rest packed in
  the bottom strip), bottom-left block and Escarabajo's glass rectangle free; mask and _s copy at the template's
  sizes (Escarabajo 512 / 256 with mips).
- RayCity UV: frame painting sees only what is in view (depth of the car rendered once) and uses the files'
  normals; parts with their own texture (tail lamps) are left off the sheet and not painted.

Video 2026-10-13 (the owner's own canyon, own UVs): the three colours work (body / hood / tail lid); the windows
came out in the body colour (the mask is red under the glass UVs, so the glass takes colour 1).
58_your_canyon_clear_glass.zip  the owner's canyon.zip with only the texels under the glass changed: mask black
                         (no garage colour), colour layer 16,20,24 alpha 96 (dark, see-through) — between pack 48
                         (black, alpha 0: fully clear) and red (glass in the paint colour). RayCity UV has a 🪟
                         glass setting (clear / clearer / paint colour); builds now default to the clear one.
The owner: the glass colour is to be Escarabajo's → builds back to Escarabajo's values (mask red, colour layer
1,1,1 alpha 0); RayCity UV's 🪟 setting lists "แบบ Escarabajo" first (58's clear look kept as an experiment).

Video 2026-10-13 15:54 (the owner's canyon): colours and glass good ("สวยมาก"); a shop decal lands wrong.
Game cars draw the sides with the front of the car to the right (Escarabajo / gtv98 sides: u ≈ −0.18·y + 0.55);
the owner's canyon has u = +0.21·y (front to the left), so decals come out back to front.
59_your_canyon_front_right.zip  the owner's canyon with the whole layout mirrored left-right inside its own box
                         (mask and colour layer mirrored with it, glass untouched): front to the right.
RayCity UV: shows which way the car faces and a ⇋ button; the glass setting has only Escarabajo's and the
owner's (mask red, colour 0,0,0,0); new-body charts now put the front to the right too.

Escarabajo's decal picture (the owner, 2026-10-13): the car unfolded on one sheet — top band (v 0-0.22) one side
upside down, middle band (0.23-0.52) the top view (hood with the big emblem at the right), lower band
(0.52-0.80) the other side upright; front of the car to the right everywhere, the numbers near the front doors.
chartsLayout (new body) and RayCity UV's 📐 button lay a car out on exactly that sheet (regions filled along
both axes), panels never sharing texture; faces looking down (floor, wheel-arch liners) go to a black spot.
(The 3D views are right as they were: a mirror tried on 2026-10-13 was taken back — Escarabajo's side text reads as in game without it. Measured on Escarabajo and gtv98: top band = +x side, u falls with y, v grows with z (upside down); middle = top view, +x at small v; lower band = −x side upright.)
60_your_canyon_decal_sheet.zip  the owner's canyon laid out on the decal sheet with RayCity UV (colours moved
                         with it), floor + wheel-arch liners black, glass untouched (mask red, colour 0,0,0,0).
Pack 60 in game: half the car black — the owner's canyon has many pieces sharing one red colour spot, and the
floor-black step painted that spot. 61_your_canyon_decal_sheet_fixed.zip: pieces on a shared red spot are laid
out on the decal sheet too (decals can show on them), faces looking down (floor, arch liners) go to a black
spot of their own; the floor tool now skips shared spots; normals pointing into the car (this canyon) are read
reversed.
Exact sheet (measured on Escarabajo; gtv98 within a few %), x, y, z scaled 0..1 over the car, y = 0 the front:
  left side  u = 1.000 − 0.891·y, v = 0.017 + 0.284·z   (upside down)
  top view   u = 0.966 − 0.804·y, v = 0.540 − 0.326·x
  right side u = 0.994 − 0.874·y, v = 0.753 − 0.291·z
chartsLayout and RayCity UV's 📐 use these numbers. The game's block in the colour layer is only u < 0.08 /
v > 0.69 and u < 0.16 / v > 0.84 (the checks now use that shape). Pack 61 rebuilt with it (0 stretched, 0 in the block).
Video 2026-10-13 16:40 (pack 61 + EMPEREUR): the decal nearly right; the owner asks for the floor and the wheel
wells black. underTris: faces looking down, plus low faces set back > 12 cm from the widest outward face of
their 10 cm slice (wheel-well walls), not looking up → the black spot (chartsLayout, 📐, ⬛).
62_your_canyon_black_wells.zip  pack 61 with the wheel wells black too (5,755 triangles on the black spot).
Pack 62 did not work in game. 63_your_canyon_59_uv_on_decal_sheet.zip: pack 59 (the good one) with nothing but
its UV moved: 59's own islands (no re-cutting) are moved / scaled onto Escarabajo's decal sheet — left side to
the upside-down top band, right side to v 0.46-0.75, top view (fitted from 59's own layout) to v 0.21-0.54,
front/rear views to the free bottom strip. Glass, part files, colour layer and all other files are 59's bytes;
the mask carries each triangle's 59 colour to its new place (every triangle keeps its colour, 147 edge
triangles of 57,105 sit on a colour edge). 0 outside the sheet, 0 in the game's block. With the test decal the
car shows the same as Escarabajo (63_decal_preview.png).
Video 2026-10-13 16:59 (pack 63): decals right, but the glass red — 59's glass / brake / indicator spots
(0.81,0.05 / 0.76,0.05 / 0.60,0.61) now lie under the decal sheet, so the film painted them.
64_your_canyon_63_glass_fixed.zip: those spots moved into Escarabajo's glass corner (u < 0.125, v 0.25-0.375,
mask red, nothing else there): glass 0.06,0.31, brake 0.06,0.35, indicator 0.09,0.35. Everything else = 63.
Video 2026-10-13 17:06 (pack 64 in game): glass clear, decals straight, white car clean. The owner: pack 64 is
the main one from now on; pack 59 is kept for now. RayCity UV's 🎯 button (move the car's own islands onto the
decal sheet) does what made pack 64 from pack 59, for any car: run on 59 it gives the same sheet, colours and glass.
Video 2026-10-13 17:14 (pack 64 in the shop): with a Film the whole glass turned one colour, and no plate.
Escarabajo measured: the film picture (128×128) sits at u 0-0.125, v 0.25-0.375 — windshield top 30 % on the
two top rows (left half v 0.252-0.287, right half 0.287-0.322), rear window on v 0.325-0.374 (u 0.008 right →
0.123 left), side windows and the rest of the windshield on the line u 0.119; the plate (0.41 × 0.11 m, 8 points,
6 triangles, frontbumper/default part 0 and rearbumper/default part 1) covers u 0.75-1, v 0.875-1 (plate
picture 256×128); nothing else uses those cells, mask red there. Pack 64 had all glass on one point of the
film's sun strip, and canyon's plate holders squashed to a point.
convert.js filmGlass / plateQuad; RayCity UV: 🪟 (glass like Escarabajo), 🔖 (plates, auto-placed on the car's
middle, sliders for height / lean / gap), 🎞 / 🔖 pictures shown on the car; 🎯 does the glass too and keeps
the plate's cell free. 65_your_canyon_film_glass_and_plates.zip: made on the page from pack 59 (🎯 then 🔖):
colours as 59 (234 of 57,105 triangles differ, nearly all on colour edges), front plate where canyon's own
holder was (z 0.50), rear plate on the rear bumper middle (z 0.48), lamps' spots at v 0.45.
Video 2026-10-13 17:35 (pack 65 in the shop): films land right (sun strip on the windshield, rear window
picture), plates show; the owner asks about black on the car. Canyon's tail panel is one brake-lamp piece
(kind 3, the whole panel, x ±0.76) and lamps take their colour from their folder's own picture (list.xml tex,
128×128 over the part's UVs — Escarabajo's escarabajo_rearlight has its red lamps); canyon's folders have no
pictures, so the lamps show black. RayCity UV now writes the lamp colour into the folder's picture when saving
(made clear 128×128 with the colour in the lamp spot's 4×4 block if missing, _s.dds 64×64 DXT3 like
Escarabajo's): brake red, indicator amber, headlight white.
66_your_canyon_65_tail_lamps.zip  pack 65 + rearlight/canyon_rearlight_default(.png/_s.dds) and _rbrc_001
(brake red at 0.06,0.45, indicator amber at 0.09,0.45). Nothing else changed.
Video 2026-10-13 17:48 (pack 66 driving): the tail panel still black; the owner asks for the car lower (wheel
arches too far above the tyres). The black is not the lamps: canyon's brake piece is only 6 small lenses plus
4 side markers; the panel around them is rearlight/default part 0 (paint, 311 triangles), and the game draws
the lamp folders' paint with the folder's own picture (Escarabajo's rearlight picture has the black housings),
not with the car's colours. RayCity UV 🧩 moves the lamp folders' paint into the bumper's paint (rear / front),
leaving one squashed triangle, so it takes the 3 colours; the "ลดความสูงรถ" slider moves every .0m down on
saving (wheels stay; mesh.xml untouched).
67_your_canyon_tail_panel_painted_lower_4cm.zip  pack 66 + 🧩 (323 triangles rearlight → rearbumper) + body 4 cm
lower (51 mesh files). With the rbrc_001 rear bumper the panel is not there (that file left as it was).
Video 2026-10-13 17:57 (pack 67 in the garage): fine overall; tail lamps / headlights missing, the tail panel
in the car colour. Then: the front wheel touches its arch a little (wheels to sit in the middle), and could
gtv98's interior come over.
Escarabajo's lamps you see are its lamp folder's paint drawn with the folder picture (red lamps, black
housings); the brake / indicator pieces only light up. RayCity UV 💡: lamp colours (white / red / amber /
black housing / back to car colour) by clicking panels; 🔴 by itself: paint facing back within 1.5 cm (6 cm
deep) of a brake lamp facing back → red, the rest of rearlight's paint → black. A lamp panel's triangles point
at the middle of a 16 × 16 px colour cell in the folder picture (top row: white, red, amber, black), so each
is one full colour at any size. Fore / aft slider next to the ride height one (wheel arches measured at
y −1.22 / 1.14; in the video the front tyre sits forward in its arch).
68_your_canyon_tail_lamps_red_lower_forward.zip  pack 66 (tail panel in rearlight) + 🔴 (339 triangles red,
88 black) + body 4 cm lower and 3 cm forward.
Video 2026-10-13 18:14 (pack 68): body shape good, but the tail panel still black / white — no red, so the
game is not drawing rearlight's paint with our picture (or not reading it). gtv98's lamp pictures (canyon's
folders come from gtv98's): rearlight 256×256, headlight 256×128, _s.dds full size DXT3 without mipmaps; ours
were 64×64 with mipmaps (Escarabajo's way). RayCity UV now writes them full size.
69_TEST_tail_picture_solid_red.zip  a test: pack 68 with rearlight's picture 256×256, every transparent pixel
solid red, _s.dds like gtv98's. Red tail panel in game = the picture is read (then the colour cells work);
still black = the picture is not read at all (check the .jmd takes rearlight/*.png and *_s.dds).
Video 2026-10-13 18:20 (test pack 69): the picture IS read — the black housing cell shows around the tail
lamps as drawn — but the test red also showed on the boot lid edge, the front bumper and the grill: folders
whose list.xml names a picture that is missing (every canyon folder but rearlight) are drawn with another
folder's picture. That is the stray colour asked about with pack 67. RayCity UV now writes a clear 128×128
picture (+ full-size _s.dds) for every picture a list.xml names that is missing.
70_your_canyon_68_every_folder_picture.zip  pack 68 (red tail cells, black housing, 4 cm lower, 3 cm forward)
+ clear pictures for frontbumper, grill, headlight, hood, mainspoiler, rearbumper, roof, skirt (default and
rbrc_001); rearlight's picture 128×128 full-size _s.dds.
The owner (pack 70): the stray colour is the shop decal's colour; the tail lamps never light (brake / reverse).
Decal: shop decals also paint the bottom strip (Escarabajo's body front / rear faces sit at u 0.7-1,
v 0.7-0.8), so canyon's front / rear / floor pieces packed there showed bits of the decal. 🎯 now packs them
left of the sheet's rear end (u < 0.10, where the sides end at 0.11 and the top view at 0.16), in three areas
clear of the film cell, lamp spots and game block (v 0.127-0.247, 0.378-0.438, 0.462-0.655).
Lamps: Escarabajo's default car uses rearlight/base with escarabajo_rearlight_base (its _s.dds differs from the
.png); its lamps (kind 3 brake, 4 indicator) are spread over a clear patch of the picture (brake u 0.272-0.373,
v 0.846-0.896; indicator 0.386-0.422, 0.858-0.894), not one opaque spot. 🔴 now does the same.
71_your_canyon_no_decal_on_bumpers_lamps_like_escarabajo.zip  pack 70 + 🎯 (156 front / rear pieces moved,
93 %) + 🔴 (lamps over Escarabajo's patches, kept clear).
Video 2026-10-13 18:39 (pack 71): lamps still never light; an earlier pack showed white in the lamp frames on
reverse. Found: part pictures are read upside down — row = (1 − v) · height. Escarabajo's and gtv98's panels
and lamps all point at v 0.75-1 and their art (dark housing band, dim lamp glows) sits in the top rows; with
v read straight they would point at empty picture. Our colour cells (top rows, v < 0.125) were read from the
bottom rows (empty), and the lamps from rows that were clear. RayCity UV now flips lamp pictures when reading
and writing, and 🔴 uses Escarabajo's own rearlight picture (escarabajo_rearlight_base, from the built-in
template): panel near the lamps → its solid red lamp texel (0.191, 0.465), the rest → its black housing
(0.113, 0.609), lamps over its brake / indicator glow patches.
72_your_canyon_escarabajo_tail_lamp_picture.zip  pack 71 with rearlight's picture = Escarabajo's
escarabajo_rearlight_base .png / _s.dds byte for byte, panel UVs on its red / black.
The owner: lower the nose so the front arch gap matches the rear. RayCity UV "กดหน้ารถลง" slider: every mesh
down by the amount at the front wheels (y −1.23), nothing at the rear wheels (1.15), straight between.
73_your_canyon_72_nose_down_2_5cm.zip  pack 72 with the nose 2.5 cm down (rear unchanged); rearlight pictures
kept as Escarabajo's bytes.
Video 2026-10-13 18:56 (pack 73): the tail lamps light up red when braking — the upside-down reading of part
pictures was the cause; Escarabajo's picture with its lamp patches works.
2026-10-14: the owner's colour layout (UV page screenshot: colour 2 green at the front / rear ends of both
sides and the top view, colour 3 blue on the hood, boot lid and the two stripes beside the hood) put into
pack 73's mask (black spots, film and plate cells kept). 74_your_canyon_73_your_colours.zip, and
74_uv_colours_with_lines.png (2048², the mask with every paint triangle's UV lines in white over it).
Videos 2026-10-14 11:04 / 11:05 (pack 74, and a yellow game car for comparison): the yellow car's tail lamps
are red all the time and brighter when braking; ours show grey boxes when off (the lamp patch is a dim, mostly
clear glow, so you look through it). 🔴 now adds a red backing 3 mm behind every lamp facing back (rearlight
paint on Escarabajo's red lamp texel): red when off, the lamp lights in front of it when braking.
75_your_canyon_74_red_tail_lamps.zip  pack 74 (your colours) + the red backing (153 triangles), Escarabajo's
rearlight picture bytes kept.
Video 2026-10-15 16:36 (pack 75): lamp boxes still grey, the red backing not red. So rearlight's paint is not
coloured by its folder picture (only the lamps kind 3 / 4 are — they light up from it); it takes the car's own
colour from the mask at its UV (Escarabajo's red texel lies on red = colour 1 = white). The fixed red / black
must come from the colour layer (canyon_color, drawn over the car where opaque, like the game block).
76_TEST_tail_lamps_red_via_colour_layer.zip  pack 75 with the lamp panel / backing on colour-layer texel
(3, 27) painted red (200,10,10) and the housing on texel (7, 27) painted black, both opaque, in the free area
left of the sheet (u 0.027 / 0.059, v 0.43). Red boxes in game = the colour layer reaches lamp parts.
The owner: with pack 75 the tail lamps light when holding reverse. Pack 76 keeps the same lamps (only the panels moved to the colour layer).
Video 2026-10-15 16:45 (pack 76): lamps red and lit when braking / reversing, grey when off; the colour-layer
texels did not reach the lamp boxes either. What shows when off is the lamp (kind 3) itself, over Escarabajo's
dim glow patch. 77_TEST_tail_lamps_left_vs_right.zip: pack 75 with each lamp spread over Escarabajo's solid red
lamp art instead, the car's left lamps (+x, on the left seen from behind) with the picture read upside down
(UV v 0.466-0.503), the right lamps read straight (v 0.497-0.534). The side that is red when off tells which
way the game reads part pictures.
