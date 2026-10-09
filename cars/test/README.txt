Finding which of our files the game rejects. Every pack unpacks to rc_canyon/ and starts from
OK_gtv98_as_rc_canyon (gtv98 renamed: confirmed working in game as "Bullet canyon"), with ONE group
of files swapped for the pickup's. Pack it to rc_canyon.jmd like always and open it in the garage.

OK_gtv98_as_rc_canyon.zip  the working base (nothing of ours)
1_all_meshes.zip           every .0m is ours (the pickup's shape, gtv98's pictures - colors will look wrong)
2_body_mesh_only.zip       only body_0/1/2.0m is ours
3_images_only.zip          every .png/.dds (and icons) is ours, gtv98's shape
4_meshxml_only.zip         only mesh.xml (collision box) is ours

Crashes in 1 but not 2 -> one of the part meshes. Crashes in 2 -> the body mesh. Crashes in 3 -> our images.
Crashes in 4 -> mesh.xml.
