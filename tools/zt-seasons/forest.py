# Magical Forest art, drawn from scratch for each season (forest5-<phone|wide>[-season].png).
# One kind of tree everywhere, so every tree changes together with the season.
# Keeps the old map's geometry: clearing (ZT_FOREST c/r), lake (copied from forest4), sign, notice-board spot.
#   python3 forest.py <icons/zt> <out>
import sys, math, random
from collections import deque
from PIL import Image
SRC, OUT = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('', '')
GEO = {'phone': dict(w=98, h=178, c=(49,103), r=(36,38), sign=(2,156), nb=(68,26,26,24)),
       'wide':  dict(w=196, h=180, c=(98,100), r=(72,46), sign=(4,158), nb=(150,16,28,26))}
OL = (43,42,58)
WATER = {(124,196,232),(90,167,207),(74,160,208),(217,240,255),(159,214,240)}
SEASONS = {
 'summer': dict(floor=[(44,107,58),(52,122,62),(36,94,52)], grass=[(95,174,62),(104,184,70),(80,156,56)], rim=(70,146,52),
                leaf=[[(150,214,96),(96,180,72),(58,140,52),(38,104,50)]], flowers=[(255,255,255),(255,226,90),(255,170,200)]),
 'spring': dict(floor=[(62,132,62),(74,148,70),(52,116,56)], grass=[(130,204,90),(146,216,104),(112,188,78)], rim=(96,170,70),
                leaf=[[(186,232,126),(134,206,94),(88,170,70),(58,132,60)]], blossom=True, flowers=[(255,190,214),(255,255,255),(255,226,90),(255,150,190)]),
 'autumn': dict(floor=[(146,88,44),(164,104,52),(124,72,38)], grass=[(176,186,92),(190,196,104),(158,168,80)], rim=(150,140,70),
                leaf=[[(252,206,96),(238,156,58),(206,108,40),(150,70,32)],
                      [(246,150,104),(222,90,62),(178,56,44),(124,38,36)],
                      [(252,228,112),(240,194,66),(208,148,44),(158,104,36)]], flowers=[(240,150,60),(214,90,46),(246,196,80)]),
 'winter': dict(floor=[(232,240,250),(244,248,253),(214,226,240)], grass=[(246,249,253),(252,253,255),(232,240,250)], rim=(214,226,240),
                leaf=[[(255,255,255),(236,243,251),(202,216,234),(150,168,196)]], snowy=True, flowers=[]),
}
TRUNK = [(140,92,52),(98,62,32)]

def lake_and_sign(k):
    """Copy the lake and the wooden sign from the current art (forest4)."""
    im = Image.open(f'{SRC}/forest4-{k}.png').convert('RGBA'); p = im.load(); W, H = im.size; keep = {}
    q = deque([(W-1, H-1)]); seen = {(W-1, H-1)}
    while q:
        x, y = q.popleft(); keep[(x,y)] = p[x,y]
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < W and 0 <= ny < H and (nx,ny) not in seen:
                c = p[nx,ny][:3]
                if c in WATER or c[2] > c[0] + 40 or (c[1] > c[0] and c[1] > c[2] and abs(nx-(W-1)) + abs(ny-(H-1)) < W*0.55 and c not in {(44,107,58),(31,77,43),(23,59,34),(63,138,46),(52,128,64)}):
                    seen.add((nx,ny)); q.append((nx,ny))
    lake = set(keep)
    # lake shore: one ring of the original pixels around the water
    for (x,y) in list(lake):
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1),(x-1,y-1)):
            if 0 <= nx < W and 0 <= ny < H and (nx,ny) not in keep: keep[(nx,ny)] = p[nx,ny]
    sx, sy = GEO[k]['sign']; sign = {}
    for y in range(sy-4, min(H, sy+20)):
        for x in range(0, sx+34):
            c = p[x,y][:3]
            if c in {OL,(168,116,63),(138,90,50),(107,68,35),(61,43,31),(176,130,80),(214,180,120),(244,232,196),(140,92,52),(98,62,32)}: sign[(x,y)] = p[x,y]
    return keep, lake, sign

def blob(r, rnd):
    """Canopy shape: three overlapping circles."""
    cs = [(0, 0, r), (-r*0.55, r*0.25, r*0.75), (r*0.55, r*0.25, r*0.75)]
    cs = [(a + rnd.uniform(-.6,.6), b + rnd.uniform(-.6,.6), c) for a,b,c in cs]
    pts = set()
    R = int(r*1.6)+2
    for y in range(-R, R+1):
        for x in range(-R, R+1):
            if any((x-a)**2 + (y-b)**2 <= c*c for a,b,c in cs): pts.add((x,y))
    return pts

def draw_tree(px, W, H, cx, cy, r, pal, S, rnd, mask):
    # trunk
    th = int(r*0.9)+2
    for y in range(cy, cy+th):
        for x in range(cx-2, cx+2):
            if 0 <= x < W and 0 <= y < H and not mask(x,y):
                px[x,y] = OL + (255,) if x in (cx-2, cx+1) or y == cy+th-1 else (TRUNK[0] if x == cx-1 else TRUNK[1]) + (255,)
    pts = blob(r, rnd)
    for (dx,dy) in pts:
        x, y = cx+dx, cy+dy-int(r*0.4)
        if not (0 <= x < W and 0 <= y < H) or mask(x,y): continue
        edge = any((dx+a, dy+b) not in pts for a,b in ((1,0),(-1,0),(0,1),(0,-1)))
        if edge: px[x,y] = OL + (255,); continue
        # light from the top-left
        l = (-dx*0.55 - dy*0.85) / r + rnd.uniform(-.12,.12)
        i = 0 if l > .55 else 1 if l > .05 else 2 if l > -.5 else 3
        c = pal[i]
        if S.get('blossom') and i <= 2 and rnd.random() < (.30 if i < 2 else .16): c = (255,196,220) if rnd.random() < .6 else (255,236,244)
        if S.get('snowy') and i >= 2 and rnd.random() < .10: c = (110,84,64)   # twigs showing under the snow
        px[x,y] = c + (255,)

def build(k, s):
    g = GEO[k]; W, H = g['w'], g['h']; S = SEASONS[s]; rnd = random.Random(f'{k}-forest')
    im = Image.new('RGBA', (W, H)); px = im.load()
    keep, lake, sign = lake_and_sign(k)
    cx, cy = g['c']; rx, ry = g['r']
    ell = lambda x, y, m=0: ((x-cx)/(rx+m))**2 + ((y-cy)/(ry+m))**2
    # floor and clearing
    for y in range(H):
        for x in range(W):
            e = ell(x, y)
            n = rnd.random()
            if e <= 1:
                c = S['grass'][0] if n < .8 else S['grass'][1] if n < .9 else S['grass'][2]
                if e > .86: c = S['rim']
            else:
                c = S['floor'][0] if n < .82 else S['floor'][1] if n < .92 else S['floor'][2]
            px[x,y] = c + (255,)
    # little things on the clearing
    for _ in range(int(rx*ry*(.012 if s in ("summer","winter") else .03))):
        a = rnd.uniform(0, 2*math.pi); d = math.sqrt(rnd.random())*.85
        x, y = int(cx + math.cos(a)*rx*d), int(cy + math.sin(a)*ry*d)
        if S['flowers']:
            col = rnd.choice(S['flowers'])
            if s == 'autumn' or s == 'spring': px[x,y] = col + (255,)
            else:
                for dx, dy in ((0,-1),(-1,0),(1,0),(0,1)): px[x+dx,y+dy] = col + (255,)
                px[x,y] = (255,226,90,255) if col != (255,226,90) else (255,255,255,255)
    if s == 'winter':  # soft drifts on the clearing
        for _ in range(int(rx*ry*.02)):
            a = rnd.uniform(0, 2*math.pi); d = math.sqrt(rnd.random())*.8
            x, y = int(cx + math.cos(a)*rx*d), int(cy + math.sin(a)*ry*d)
            for dx in range(-2, 3): px[x+dx,y] = (226,234,246,255)
    # trees all around the clearing (one kind of tree, same season for all)
    nbx, nby, nbw, nbh = g['nb']; sx, sy = g['sign']
    def free(x, y):
        if ell(x, y, 3) <= 1: return False
        if (x,y) in lake or any((x+a, y+b) in lake for a,b in ((0,8),(6,6),(-6,6),(8,0),(-8,0),(0,-4))): return False
        if nbx-6 <= x <= nbx+nbw+4 and nby-6 <= y <= nby+nbh+8: return False
        if sx-4 <= x <= sx+34 and sy-10 <= y <= sy+22: return False
        return True
    spots = []
    step_x, step_y = 15, 12
    for row, y in enumerate(range(-4, H+10, step_y)):
        for x in range(-6 + (row % 2)*7, W+8, step_x):
            tx, ty = x + rnd.randint(-3,3), y + rnd.randint(-2,2)
            if free(tx, ty) and free(tx, ty+8): spots.append((ty, tx, rnd.uniform(10, 12) if rnd.random() < .15 else rnd.uniform(6.5, 9.5)))
    spots.sort()
    mask = lambda x, y: (x,y) in keep or (x,y) in sign
    for (ty, tx, r) in spots:
        pal = S['leaf'][rnd.randrange(len(S['leaf']))] if len(S['leaf']) > 1 else S['leaf'][0]
        rnd.random()
        draw_tree(px, W, H, tx, ty, r, pal, S, rnd, mask)
    # rocks and mushrooms near the edge of the clearing
    for _ in range(5 if k == 'wide' else 3):
        a = rnd.uniform(0, 2*math.pi); x, y = int(cx + math.cos(a)*(rx+3)), int(cy + math.sin(a)*(ry+3))
        if 1 < x < W-3 and 1 < y < H-3 and free(x, y) is False and ell(x, y) > 1 and not mask(x, y):
            px[x,y] = (201,194,180,255); px[x+1,y] = (226,214,190,255); px[x,y+1] = (178,164,140,255); px[x+1,y+1] = (163,155,139,255)
            if s == 'winter': px[x,y-1] = px[x+1,y-1] = (255,255,255,255)
    # lake + sign from the old art (frozen in winter)
    for (x,y), c in keep.items():
        g3 = c[:3]
        if s != 'summer' and (x,y) not in lake and g3[1] > g3[0] + 25 and g3[1] > g3[2] + 25 and g3[2] < 120:
            px[x,y] = S['floor'][2] + (255,); continue
        if s == 'winter' and (x,y) in lake:
            c3 = c[:3]
            c = ((230,242,252,255) if c3 in {(217,240,255)} else (206,228,246,255) if c3 in WATER else (196,220,240,255))
        elif s == 'winter':
            c = c if c[:3] not in {(63,138,46),(44,107,58),(31,77,43),(95,174,62),(104,178,70)} else S['floor'][0] + (255,)
        elif c[:3] in {(63,138,46),(44,107,58),(31,77,43),(23,59,34),(52,128,64)} and s != 'summer':
            c = S['floor'][0] + (255,)
        px[x,y] = c
    for (x,y), c in sign.items():
        px[x,y] = c
        if s == 'winter' and c[:3] == OL and y > 0 and (x, y-1) not in sign: px[x,y-1] = (255,255,255,255)
    return im

if __name__ == '__main__':
    for k in GEO:
        for s in SEASONS:
            name = f'forest5-{k}' + ('' if s == 'summer' else f'-{s}')
            build(k, s).save(f'{OUT}/{name}.png')
    print('ok')
