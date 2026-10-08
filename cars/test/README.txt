Test packs for finding why the game crashes. Every zip unpacks to a folder named rc_canyon.
Delete the current rc_canyon folder in the game before putting a test in.

test1_escarabajo_as_rc_canyon.zip
  The game's own escarabajo, only renamed to rc_canyon (files and list.xml).
  Crashes too → the cause is the car's registration (database, e.g. RC_CarInfo), not our files.

test2_rc_canyon_old.zip
  The previous rc_canyon, the one that could be spawned before.
  Crashes now as well → something outside the car folder changed since then.

test3_rc_canyon_as_escarabajo.zip
  The new rc_canyon renamed to escarabajo (unpacks to a folder named escarabajo, spec xml left out).
  Back up the game's escarabajo folder, put this one in its place, then open an escarabajo in the
  garage. Works → our files are fine and the crash comes from registering a new car name
  (client-side car data). Crashes → the files themselves are the problem.

Known so far: the old rc_canyon (test2) spawns but crashes in the garage; the new rc_canyon
(cars/rc_canyon) crashes already when spawned.

test4_new_mesh_old_textures.zip
  New .0m meshes with the old textures and list.xml. Crashes on spawn → the new meshes are the cause.

test5_old_mesh_new_textures.zip
  Old .0m meshes with the new textures (DXT3) and list.xml. Crashes on spawn → the new textures or
  list.xml are the cause.

test6_old_rc_canyon_doors_fixed.zip   <- try this first
  The old rc_canyon (the one that spawns) with the door fix: every .0m now has the submesh layout of
  escarabajo's file, including the moving pieces the garage animates (doors 0/1 in roof, hood = door 2,
  door windows, h11000 spoiler). Our car had none of them, so opening the doors in the garage crashed.
  cars/rc_canyon (the new build) has the same fix.
