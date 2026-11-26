# Zest Town seasons

The town is drawn by hand once (`icons/zt/town7-*.png`, `tree4-*`, `river3-*`, `bridge-*`: the summer look).
These scripts make every other look from it. After changing the town art, run from the repo root:

    python3 tools/zt-seasons/season.py icons/zt icons/zt   # spring / autumn / winter town, trees, river, bridge
    python3 tools/zt-seasons/forest.py icons/zt icons/zt   # Magical Forest, all seasons (forest5-*), lake + sign copied from forest4-*
    python3 tools/zt-seasons/lny.py    icons/zt icons/zt   # Lunar New Year night + winter with the Christmas tree

Then bump the app version. If a building moves or a new one is added, update the lantern spots next to its door
(`DOORS` in lny.py) and the Christmas tree spot (end of lny.py, and `ZT_XMAS` in app.js so nobody walks through it).
