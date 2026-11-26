# Lunar New Year week: the town and the forest at night, red lanterns, plum blossom. Made from the base art.
import sys, math, random
from PIL import Image
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprites import lantern, xmas
import forest
SRC, OUT = sys.argv[1], sys.argv[2]
OL = (43,42,58)
WIN = {}
KEEP = {(226,58,80),(255,150,170)}
LEAF = {(150,214,96),(96,180,72),(58,140,52)}
def night(im, windows=False, blossom=False, seed=''):
    im = im.convert('RGBA'); p = im.load(); W, H = im.size; rnd = random.Random(seed)
    for y in range(H):
        for x in range(W):
            r, g, b, a = p[x,y]
            if a == 0: continue
            if windows and (r,g,b) in WIN: p[x,y] = WIN[(r,g,b)] + (a,); continue
            if (r,g,b) in KEEP: p[x,y] = (int(r*.85), int(g*.8), int(b*.85), a); continue
            if blossom and (r,g,b) in LEAF and (r,g,b) != (58,140,52) and rnd.random() < .45:
                p[x,y] = ((214,60,84) if rnd.random() < .6 else (240,140,160)) + (a,); continue
            p[x,y] = (int(r*.52+6), int(g*.52+10), int(b*.6+40), a)
    return im
def glow(im, x, y, rad=11, col=(255,160,70), k=.55):
    p = im.load(); W, H = im.size
    for yy in range(max(0,y-rad), min(H,y+rad+1)):
        for xx in range(max(0,x-rad), min(W,x+rad+1)):
            d = math.hypot(xx-x, (yy-y)*1.1)
            if d > rad: continue
            t = k * (1 - d/rad)**1.6; r, g, b, a = p[xx,yy]
            if a == 0: continue
            p[xx,yy] = (min(255,int(r + (col[0]-r)*t)), min(255,int(g + (col[1]-g)*t)), min(255,int(b + (col[2]-b)*t)), a)
def lanterns(im, pts, string=None):
    L = lantern()
    for (x,y) in pts: glow(im, x, y+4, rad=14, k=.6)
    p = im.load()
    if string:  # a dark cord between two points, lanterns hang from it
        (x0,y0),(x1,y1) = string
        for x in range(x0, x1+1):
            t = (x-x0)/max(1,x1-x0); yy = int(y0 + (y1-y0)*t + 3*math.sin(math.pi*t))
            p[x,yy] = (70,40,40,255)
    for (x,y) in pts: im.alpha_composite(L, (x-3, y))
    return im
# lanterns on both sides of each door: (centre x, top y), from the town7 art
DOORS = {'wide': [(57,47),(72,47), (120,32),(132,32), (164,40),(179,40), (33,124),(45,124), (187,122),(201,122), (54,208),(63,208)],
         'phone': [(28,35),(40,35), (79,29),(91,29), (24,167),(34,167), (81,167),(93,167), (33,232),(45,232), (82,238),(91,238)]}
PLAZA = {'wide': (118,120), 'phone': (59,86)}
def town(k):
    im = night(Image.open(f'{SRC}/town7-{k}.png'), blossom=True, seed=k)
    S = lantern(small=True)
    for (x, y) in DOORS[k]: glow(im, x, y+4, rad=9, k=.55)
    for (x, y) in DOORS[k]: im.alpha_composite(S, (x-2, y))
    # the string of lanterns between the two lamp posts on the streak tree's square
    px, py = PLAZA[k]; span = 18
    pts = [(px-span+7+i*8, py-13) for i in range(4)]
    return lanterns(im, pts, ((px-span, py-15), (px+span, py-15)))
def forest_lny(k):
    S = dict(forest.SEASONS['summer']); S['leaf'] = [[(150,214,96),(96,180,72),(58,140,52),(38,104,50)]]; S['blossom'] = True
    S['flowers'] = [(236,72,96),(255,170,190),(255,226,90)]
    forest.SEASONS['lny'] = S
    im = forest.build(k, 'lny')
    # plum blossom is red, not cherry pink
    p = im.load(); W, H = im.size
    for y in range(H):
        for x in range(W):
            c = p[x,y][:3]
            if c == (255,196,220): p[x,y] = (226,58,80,255)
            elif c == (255,236,244): p[x,y] = (255,150,170,255)
    im = night(im, seed=k)
    g = forest.GEO[k]; cx, cy = g['c']; rx, ry = g['r']
    pts = []
    n = 9 if k == 'wide' else 6
    for i in range(n):
        a = math.pi * (1.05 + 0.9 * i / (n-1))  # along the top half of the clearing
        pts.append((int(cx + math.cos(a)*(rx+2)), int(cy + math.sin(a)*(ry+2)) - 6))
    for i in range(3 if k == 'wide' else 2):
        a = math.pi * (0.15 + 0.35*i)
        pts.append((int(cx + math.cos(a)*(rx+1)) - (6 if k=='phone' else 0), int(cy + math.sin(a)*(ry+1)) - 8))
    return lanterns(im, pts)
if __name__ == '__main__':
    for k in ('wide', 'phone'):
        town(k).save(f'{OUT}/town7-{k}-lny.png')
        forest_lny(k).save(f'{OUT}/forest5-{k}-lny.png')
        for f in (f'river3-{k}', f'bridge-{k}'): night(Image.open(f'{SRC}/{f}.png'), seed=f).save(f'{OUT}/{f}-lny.png')
    for f in ('tree4-big', 'tree4-small'): night(Image.open(f'{SRC}/{f}.png'), blossom=True, seed=f).save(f'{OUT}/{f}-lny.png')
    # winter + Christmas tree (December)
    X = xmas()
    for k, (x, y) in {'wide': (92, 224), 'phone': (22, 152)}.items():
        im = Image.open(f'{OUT}/town7-{k}-winter.png').convert('RGBA')
        im.alpha_composite(X, (x - X.width//2, y - X.height)); im.save(f'{OUT}/town7-{k}-xmas.png')
    print('ok')
