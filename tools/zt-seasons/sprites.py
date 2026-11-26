from PIL import Image
OL=(43,42,58)
def xmas():
    # 19 x 28 Christmas tree: snowy tiers, red and gold baubles, star, gifts
    W,H=23,30; im=Image.new("RGBA",(W,H)); p=im.load(); cx=11
    G=[(40,110,70),(30,88,58),(22,66,46)]
    tiers=[(5,4,4),(9,7,6),(14,9,7),(19,10,7)]  # (y top, half width at bottom, height)
    for (yt,hw,hh) in tiers:
        for dy in range(hh):
            w=int(1+(hw-1)*dy/(hh-1))
            for dx in range(-w,w+1):
                x,y=cx+dx,yt+dy
                p[x,y]=(G[0] if dx<0 else G[1] if dx<w-1 else G[2])+(255,)
            p[cx-w-1,yt+dy]=OL+(255,); p[cx+w+1,yt+dy]=OL+(255,)
        for dx in range(-hw-1,hw+2): p[cx+dx,yt+hh]=OL+(255,)
        # snow on the tier's upper edge
        for dy in range(hh):
            w=int(1+(hw-1)*dy/(hh-1))
            if dy%2==0: p[cx-w,yt+dy]=(250,252,255,255)
    p[cx,3]=OL+(255,)
    # star
    for x,y in [(cx,0),(cx-1,1),(cx,1),(cx+1,1),(cx,2),(cx-2,1),(cx+2,1)]: p[x,y]=(255,214,64,255)
    # baubles
    for (x,y,c) in [(cx-2,8,(214,48,48)),(cx+2,10,(255,200,60)),(cx-4,14,(255,200,60)),(cx+3,15,(214,48,48)),(cx,17,(80,150,230)),(cx-5,20,(214,48,48)),(cx+5,21,(255,200,60)),(cx-1,23,(255,200,60)),(cx+2,24,(214,48,48)),(cx-7,25,(80,150,230)),(cx+7,25,(214,48,48))]:
        p[x,y]=c+(255,)
    # trunk
    for y in (27,28):
        for x in (cx-1,cx,cx+1): p[x,y]=(122,80,40,255)
    for x in range(cx-2,cx+3): p[x,29]=OL+(255,)
    # gifts
    for (x0,c) in [(cx-7,(214,48,48)),(cx+4,(60,140,200))]:
        for y in range(26,30):
            for x in range(x0,x0+4): p[x,y]=(OL if y in (26,29) or x in (x0,x0+3) else c)+(255,)
        p[x0+1,27]=p[x0+2,27]=(255,214,64,255); p[x0+1,28]=(255,214,64,255)
    return im
def lantern(small=False):
    if small:
        rows=[' oGo ','oRRRo','oRrRo','oRrRo','oRRRo',' oGo ','  t  ']
    else:
        rows=['  oGo  ',' oRRRo ','oRRrRRo','oRrrrRo','oRRrRRo',' oRRRo ','  oGo  ','   t   ','  t t  ']
    W,H=7,len(rows); im=Image.new('RGBA',(W,H)); p=im.load()
    col={'o':OL,'R':(226,44,40),'r':(255,170,90),'G':(250,200,64),'t':(250,200,64)}
    for y,row in enumerate(rows):
        for x,ch in enumerate(row):
            if ch!=' ': p[x,y]=col[ch]+(255,)
    return im
