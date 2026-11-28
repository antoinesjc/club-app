import parselmouth, subprocess, numpy as np
from parselmouth.praat import call
A='audio/py/'  # run from the repo root; writes t-*.mp3 to the current folder
def L(n): return 190*(370/190)**((n-1)/4)
CONT={1:[(0,5),(1,5)],2:[(0,3),(0.25,3.2),(1,5)],3:[(0,2.2),(0.45,1),(0.7,1.2),(1,4)],4:[(0,5),(0.15,5),(1,1)],5:[(0,3),(1,2.6)]}
def make(syl,t):
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',A+f'y-{syl}.mp3','-ac','1','-ar','22050','in.wav'],check=True)
    snd=parselmouth.Sound('in.wav')
    pitch=snd.to_pitch(time_step=0.01,pitch_floor=120,pitch_ceiling=500)
    f=pitch.selected_array['frequency']; ts=pitch.xs(); v=ts[f>0]
    t0,t1=v[0],v[-1]
    man=call(snd,"To Manipulation",0.01,120,500)
    tier=call("Create PitchTier","t",snd.xmin,snd.xmax)
    for x,lv in CONT[t]: call(tier,"Add point",t0+(t1-t0)*x,L(lv))
    call([tier,man],"Replace pitch tier")
    if t in (3,5):
        dur=call("Create DurationTier","d",snd.xmin,snd.xmax)
        k=1.25 if t==3 else 0.55
        call(dur,"Add point",t0,k); call(dur,"Add point",t1,k)
        call([dur,man],"Replace duration tier")
    out=call(man,"Get resynthesis (overlap-add)")
    if t==5:  # softer
        out.values*=0.75
    out.save('o.wav','WAV')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i','o.wav','-b:a','64k',f't-{syl}{t}.mp3'],check=True)
for s in ['ma','ba','ni','da','hao','mi','tu','li']:
    for t in range(1,6): make(s,t)
print('ok')
