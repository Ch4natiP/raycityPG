Every pack unpacks to rc_canyon/; pack it to rc_canyon.jmd as usual.

In game (2026-10-09): every pickup mesh, our images, our mesh.xml and skirt load fine (packs 2-7, 13, 16:
no crash). Pack 13 showed dark triangle patches: the detail was baked into <car>_color.png / the
part textures, but the game does not draw those at the parts' UVs. The original cars' UVs only ever
land on transparent pixels there. Their look comes from the paint mask <car>_base.png alone.

17_full_mask_textures.zip  the current pickup (= cars/rc_canyon.zip): detail baked into the paint
                           mask (red = paint, black = trim/windows/tyres), color and part textures
                           transparent like the original cars
16_full_safe.zip           previous full pickup, passed (old texture style)
OK_gtv98_as_rc_canyon.zip  gtv98 renamed: the working base
