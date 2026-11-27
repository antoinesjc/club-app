# Seasonal art for Zest Town and the Magical Forest, made from the base (summer) art.
# Edit the base art once, run this, and spring / autumn / winter follow.
#   python3 season.py <icons/zt> <out>
import sys, random, hashlib
from collections import deque
from PIL import Image
SRC, OUT = sys.argv[1], sys.argv[2]
FILES = ['town8-wide','town8-phone','tree4-big','tree4-small','river3-wide','river3-phone','bridge-wide','bridge-phone']
OUTLINE = {(43,42,58),(29,29,36)}
GRASS = {(143,207,90):0,(130,194,80):1,(121,184,74):2,(166,221,111):3,(112,172,70):4,(126,188,78):1,(111,191,76):1,(150,206,98):3,
         (95,174,62):0,(104,178,70):0,(79,154,74):1,(86,160,80):1,(100,160,64):4,(47,107,34):4}
SAND = {(232,210,160),(214,188,132),(217,201,166),(243,226,186)}
# leaf greens, lightest (0) to darkest (4); used by canopies, bushes and the forest floor
LEAF = {(150,214,96):0,(96,180,72):1,(58,140,52):2,(52,128,64):2,(63,138,46):2,(44,107,58):3,(30,88,46):3,(31,77,43):4,(23,59,34):4}
FLOWER = {(255,170,200),(226,110,150),(230,110,150),(255,182,193),(246,176,192),(178,140,220)}
YELLOW = {(255,226,90),(255,217,90),(255,210,80),(214,160,30),(255,230,128),(255,246,168)}
WATER = {(124,196,232):0,(90,167,207):1,(74,160,208):1,(217,240,255):2,(159,214,240):0}
GRASSP = {
 'spring': [(150,214,98),(137,202,88),(126,190,80),(176,228,122),(118,180,76)],
 'autumn': [(176,198,94),(162,184,82),(150,172,76),(198,212,112),(140,160,70)],
 'winter': [(238,244,250),(224,233,244),(212,224,238),(250,252,255),(200,214,230)],
}
FLOOR = {  # the forest floor between the trees
 'spring': [(150,214,96),(110,186,80),(70,150,58),(48,118,60),(34,90,48)],
 'autumn': [(214,150,70),(186,112,52),(150,84,42),(120,64,36),(92,48,30)],
 'winter': [(250,252,255),(236,242,250),(222,232,244),(206,220,236),(190,206,226)],
}
CANOPY = {
 'spring': [[(170,228,116),(112,194,86),(70,154,62),(46,118,60),(30,86,46)],            # fresh green
            [(255,232,240),(255,196,218),(236,150,184),(196,112,150),(150,80,116)]],    # cherry blossom
 'autumn': [[(250,214,92),(236,170,56),(204,124,40),(158,88,32),(112,62,28)],
            [(246,176,72),(236,128,48),(204,84,40),(150,56,32),(108,40,28)],
            [(240,120,96),(214,72,56),(170,46,44),(124,34,36),(90,28,30)]],
 'winter': [[(236,244,250),(96,146,128),(56,110,92),(40,86,72),(26,62,52)],
            [(124,174,152),(74,128,106),(50,100,82),(36,78,64),(24,56,46)]],
}
def h(*a): return int(hashlib.md5(repr(a).encode()).hexdigest()[:8], 16)

def regions(im):
    """Label 4-connected areas of non-outline pixels: the open ground is the biggest; each outlined thing is its own."""
    W, H = im.size; p = im.load(); lab = [[-1]*W for _ in range(H)]; sizes = []
    for sy in range(H):
        for sx in range(W):
            if lab[sy][sx] != -1 or p[sx,sy][3] == 0 or p[sx,sy][:3] in OUTLINE: continue
            k = len(sizes); q = deque([(sx,sy)]); lab[sy][sx] = k; n = 0
            while q:
                x, y = q.popleft(); n += 1
                for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                    if 0 <= nx < W and 0 <= ny < H and lab[ny][nx] == -1 and p[nx,ny][3] and p[nx,ny][:3] not in OUTLINE:
                        lab[ny][nx] = k; q.append((nx,ny))
            sizes.append(n)
    return lab, sizes

def season(img, s, name):
    im = img.convert('RGBA'); W, H = im.size; src = im.copy().load(); px = im.load()
    lab, sizes = regions(im)
    ground_k = max(range(len(sizes)), key=lambda k: sizes[k]) if sizes and name.startswith(('town','forest')) else None
    on_ground = lambda x, y: ground_k is not None and lab[y][x] == ground_k
    for y in range(H):
        for x in range(W):
            r, g, b, a = src[x,y]; c = (r,g,b)
            if a == 0 or c in OUTLINE: continue
            if c in GRASS and (on_ground(x,y) or ground_k is None): px[x,y] = GRASSP[s][GRASS[c]] + (a,)
            elif c in LEAF:
                i = LEAF[c]
                if on_ground(x,y): px[x,y] = FLOOR[s][i] + (a,)
                else:
                    pals = CANOPY[s]; k = lab[y][x]
                    if s == 'spring': pal = pals[1] if (name.startswith('tree') or h(k, name) % 100 < 35) else pals[0]
                    else: pal = pals[h(k, name) % len(pals)]
                    px[x,y] = pal[i] + (a,)
            elif s == 'winter' and c in SAND: px[x,y] = (220,226,236,a)
            elif s == 'winter' and c in WATER: px[x,y] = [(218,236,248),(190,218,238),(246,251,255)][WATER[c]] + (a,)
            elif s == 'winter' and on_ground(x,y) and (c in FLOWER or c in YELLOW): px[x,y] = GRASSP[s][0] + (a,)
            elif s != 'spring' and c in FLOWER: px[x,y] = ({'autumn':[(240,150,60),(232,196,80)],'winter':[(214,58,58),(170,40,40)]}[s][h(x,y) % 2]) + (a,)
    if s == 'winter':  # snow on top of everything that stands up: roofs, canopies, fences, rocks
        for x in range(W):
            for y in range(1, H-3):
                top = src[x,y]; above = src[x,y-1]
                if top[:3] in OUTLINE and (above[3] == 0 or on_ground(x, y-1)):
                    for d in (1, 2):
                        c2 = src[x,y+d]
                        if c2[3] == 0 or c2[:3] in OUTLINE or on_ground(x, y+d): break
                        px[x,y+d] = (255,255,255,255) if d == 1 else (226,236,248,255)
    if s in ('spring','autumn') and ground_k is not None:  # petals / fallen leaves on the grass
        rnd = random.Random(name + s)
        for _ in range(W*H // (80 if s == 'spring' else 110)):
            x, y = rnd.randrange(W), rnd.randrange(H)
            if on_ground(x,y) and src[x,y][:3] in GRASS:
                px[x,y] = (255,200,220,255) if s == 'spring' else rnd.choice([(234,140,50,255),(200,90,40,255),(246,190,70,255)])
    return im

if __name__ == '__main__':
    for f in FILES:
        for s in GRASSP:
            try: season(Image.open(f'{SRC}/{f}.png'), s, f).save(f'{OUT}/{f}-{s}.png')
            except FileNotFoundError: pass
    print('ok')
