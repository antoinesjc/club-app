# Walking grid for the fruit and the qilin (ZT_WALK in app.js), worked out from the town art.
from PIL import Image
import numpy as np, json
from scipy.ndimage import uniform_filter, label
import sys
Z=sys.argv[1].rstrip('/')+'/'  # python3 tools/zt-seasons/walk.py icons/zt  -> walk3.json = ZT_WALK in app.js
MAPS={
 'phone':dict(img='town8-phone.png',g=3,tree=(38,49),river=(110,29),bridge=(54,117,11,18),fsign=(91,98,24),
   trees=[[42,-10,0],[-6,-8,1],[100,-8,1],[106,116,0],[-4,120,0],[102,194,1],[-6,196,1],[-4,248,1],[100,250,1],[-6,286,1],[100,288,1]],lots=[(88,236),(59,284)]),
 'wide':dict(img='town8-wide.png',g=4,tree=(97,84),river=(160,30),bridge=(113,160,11,17),fsign=(196,186,32),
   trees=[[-4,-6,1],[178,-6,0],[196,-6,1],[28,-4,0],[214,2,1],[12,4,1],[2,18,0],[222,30,0],[216,80,1],[2,82,1],[222,100,0],[-2,104,0],[0,188,1],[18,196,1],[150,196,1],[222,196,0],[170,200,0]],lots=[(60,212),(168,212)]),
}
FW,FH=20,18
out={}
for k,m in MAPS.items():
    a=np.array(Image.open(Z+m['img']).convert('RGB')).astype(int); H,W=a.shape[:2]
    r,g,b=a[...,0],a[...,1],a[...,2]
    green=(g>r+15)&(g>b+15)
    sand=(r>200)&(g>170)&(b>110)&(b<190)&(r>g)   # plaza / paths / plots
    stone=(abs(r-g)<25)&(abs(g-b)<25)&(r>170)       # path stones
    ok=green|sand|stone
    walk=uniform_filter(ok.astype(float),3)>0.8
    block=np.zeros((H,W),bool)
    ry,rh=m['river']; block[ry-1:ry+rh+1,:]=True
    bx,by,bw,bh=m['bridge']; block[ry-1:ry+rh+1,bx+1:bx+bw-1]=False
    tx,ty=m['tree']; block[ty+4:ty+44, tx+8:tx+34]=True
    fx,fy,fs=m['fsign']; block[max(0,fy):fy+int(fs*0.8), fx:fx+fs]=True
    def clear(t,lot):
        x,y,big=t; px,py=lot
        return x+(24 if big else 17)<px-30 or x>px+30 or y+(30 if big else 22)<py-20 or y>py+30
    for x,y,big in [t for t in m['trees'] if all(clear(t,l) for l in m['lots'])]:
        w=24 if big else 17; h=30 if big else 22
        block[max(0,y+h-10):max(0,y+h+1), max(0,x+3):max(0,x+w-3)]=True
    walk&=~block
    walk[ry-1:ry+rh+2,bx:bx+bw]=True
    if k=='phone': walk[140:262,55:63]=True  # the stone path between the Library and the Calligraphy School
    G=m['g']; spots=[]
    for y in range(0,H-FH,G):
        for x in range(-4,W-FW+4,G):
            x0,x1=max(0,x+7),min(W,x+FW-7)
            feet=walk[y+FH-5:y+FH,x0:x1]
            if feet.size and feet.mean()>0.97: spots.append((x,y))
    # keep the biggest connected group (grid neighbours)
    S={p:i for i,p in enumerate(spots)}; comp=[-1]*len(spots); c=0
    for i,p in enumerate(spots):
        if comp[i]>=0: continue
        st=[i]; comp[i]=c
        while st:
            u=st.pop(); ux,uy=spots[u]
            for dx in (-G,0,G):
                for dy in (-G,0,G):
                    v=S.get((ux+dx,uy+dy))
                    if v is not None and comp[v]<0: comp[v]=c; st.append(v)
        c+=1
    from collections import Counter
    big=Counter(comp).most_common(1)[0][0]
    keep=[p for i,p in enumerate(spots) if comp[i]==big]
    print(k,len(spots),len(keep),Counter(comp).most_common(4))
    out[k]={'g':G,'p':[v for p in keep for v in p]}
    im=Image.open(Z+m['img']).convert('RGB'); px=im.load()
    for x,y in keep:
        cx,cy=x+FW//2,y+FH-2
        if 0<=cx<W and 0<=cy<H: px[cx,cy]=(255,0,0)
    im.resize((W*2,H*2),Image.NEAREST).save(f'w2-{k}.png')
json.dump(out,open('walk3.json','w'),separators=(',',':'))
