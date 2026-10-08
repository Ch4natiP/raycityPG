Test packs for finding why the game crashes. Every zip unpacks to a folder named rc_canyon.
Delete the current rc_canyon folder in the game before putting a test in.

test1_escarabajo_as_rc_canyon.zip
  The game's own escarabajo, only renamed to rc_canyon (files and list.xml).
  Crashes too → the cause is the car's registration (database, e.g. RC_CarInfo), not our files.

test2_rc_canyon_old.zip
  The previous rc_canyon, the one that could be spawned before.
  Crashes now as well → something outside the car folder changed since then.
