Test packs, built from gtv98 (a car that works in game). Back up the game's own folders before testing.

A_gtv98_named_rc_canyon.zip  -> unpacks to rc_canyon/
  The game's own gtv98, only renamed to rc_canyon. Put it in place of rc_canyon, spawn, open in garage.
  Crashes -> the problem is registering the new car (database / client data), not the 3D files.

B_pickup_named_gtv98.zip     -> unpacks to gtv98/
  Our pickup, renamed to gtv98. Back up gtv98, put this in its place, open a gtv98 you own.
  Works -> our files are fine; only the new car's registration is missing.

C_gtv98_with_pickup_body.zip -> unpacks to gtv98/
  The game's gtv98 with only body_0/1/2.0m replaced by our pickup body (looks half pickup, half gtv98).
  Use it when B crashes: works -> the problem is in our parts or textures; crashes -> in the body mesh.

Older test packs are in the git history.
