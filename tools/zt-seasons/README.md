# Zest Town seasons

The town is drawn by hand once (`icons/zt/town7-*.png`; `arcade_lot.py` adds the Arcade to make `town8-*`, `tree4-*`, `river3-*`, `bridge-*`: the summer look).
These scripts make every other look from it. After changing the town art, run from the repo root:

    python3 tools/zt-seasons/season.py icons/zt icons/zt   # spring / autumn / winter town, trees, river, bridge
    python3 tools/zt-seasons/forest.py icons/zt icons/zt   # Magical Forest, all seasons (forest5-*), lake + sign copied from forest4-*
    python3 tools/zt-seasons/lny.py    icons/zt icons/zt   # Lunar New Year night + winter with the Christmas tree

    (first, if town7 or arcade.png changed: python3 tools/zt-seasons/arcade_lot.py icons/zt)

Then bump the app version. If buildings move, recompute the walking grid (`ZT_WALK` in app.js). If a building moves or a new one is added, update the lantern spots next to its door
(`DOORS` in lny.py) and the Christmas tree spot (end of lny.py, and `ZT_XMAS` in app.js so nobody walks through it).
