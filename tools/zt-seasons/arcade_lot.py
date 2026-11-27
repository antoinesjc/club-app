# Builds town8-* (the town with the Arcade) from town7-*: copies the Post Office's lot (sandy plot + bushes) to the
# Arcade's spot and puts arcade.png on it. Phone: one more 48px row at the bottom for it.
#   python3 tools/zt-seasons/arcade_lot.py icons/zt
import sys
from PIL import Image
Z = sys.argv[1].rstrip('/') + '/'
GRASS = {(143,207,90),(130,194,80),(121,184,74),(166,221,111),(112,172,70),(126,188,78),(111,191,76),(150,206,98),(100,160,64)}
post = Image.open(Z+'post.png').convert('RGBA'); arc = Image.open(Z+'arcade.png').convert('RGBA'); SAND = (232,210,160,255)
def place(bg, src_c, dst_c, box):
    (sx,sy),(dx,dy) = src_c, dst_c; x0,y0,x1,y1 = box
    patch = bg.crop((sx+x0, sy+y0, sx+x1, sy+y1)).copy(); pp = patch.load(); ox, oy = -x0-21, -y0-18; pm = post.load()
    for y in range(post.height):
        for x in range(post.width):
            if pm[x,y][3] and 0 <= x+ox < patch.width and 0 <= y+oy < patch.height: pp[x+ox,y+oy] = SAND if y >= post.height - 6 else (143,207,90,255)
    patch.alpha_composite(arc, (ox, oy)); bp = bg.load()
    for y in range(patch.height):
        for x in range(patch.width):
            c = pp[x,y]
            if c[:3] not in GRASS: bp[dx+x0+x, dy+y0+y] = c
w = Image.open(Z+'town7-wide.png').convert('RGBA'); place(w, (60,212), (168,212), (-26,-24,28,26)); w.save(Z+'town8-wide.png')
p = Image.open(Z+'town7-phone.png').convert('RGBA'); W, H = p.size
n = Image.new('RGBA', (W, H+48)); n.paste(p, (0,0)); n.paste(p.crop((0,105,W,153)), (0,H))
place(n, (88,236), (59,284), (-26,-22,27,26)); n.save(Z+'town8-phone.png')
print('ok')
