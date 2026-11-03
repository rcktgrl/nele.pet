import json,re,collections,copy
from slots import empties
fleet=json.load(open('fleet.json'))
SZ={4:'huge',3:'large',2:'medium',1:'small'}
items=collections.Counter(m['Item'].lower() for s in fleet for m in s['Modules'])
def best(pred):
    c=[(n,i) for i,n in items.items() if pred(i)]
    return max(c)[1] if c else None
WEAP={k:best(lambda i,k=k: i.startswith('hpt_') and i.endswith('_'+SZ[k]) and not re.search('mining|minelauncher|subsurf|seismchrg|abrblstr',i)) for k in SZ}
UTIL='hpt_shieldbooster_size0_class5'
def shieldgen(n):
    for c in (5,4,3,2):
        for sz in range(n,0,-1):
            it=f'int_shieldgenerator_size{sz}_class{c}'
            if items[it]: return it
def hrp(n): return f'int_hullreinforcement_size{min(n,5)}_class2'
def cargo(n): return f'int_cargorack_size{n}_class1'
def gsr(n): return f'int_guardianshieldreinforcement_size{min(n,5)}_class2'
def role(s):
    its=[m['Item'].lower() for m in s['Modules']]
    w=sum(1 for i in its if i.startswith('hpt_') and 'size0' not in i and 'tiny' not in i)
    c=sum(1 for i in its if 'cargorack' in i)
    if s['Ship'].lower() in ('type6','type8','type9','panthermkii','belugaliner','cobramkv','python'): return 'trader' if c or w==0 else 'combat'
    if s['Ship'].lower() in ('diamondbackxl','explorer_nx','asp'): return 'explorer' if w==0 else 'combat'
    return 'trader' if c and w==0 else 'combat'
report=[]
for s in fleet:
    e=empties(s)
    if s['ShipName'].strip().lower() not in ('efs odin','efs anubis'): continue
    if not e: continue
    hp,ints=e
    if not hp and not ints: continue
    r=role(s);added=[]
    used={m['Slot'].lower() for m in s['Modules']}
    def slotname(base):
        n=1
        while f'{base}{n}' in used: n+=1
        used.add(f'{base}{n}');return f'{base}{n}'
    for size,cnt in sorted(hp.items(),reverse=True):
        for _ in range(cnt):
            if size==0: it=UTIL;sl=slotname('tinyhardpoint')
            else: it=WEAP[size];sl=slotname(SZ[size]+'hardpoint')
            if it: added.append({'Slot':sl,'Item':it,'On':True,'Filled':True})
    its=[m['Item'].lower() for m in s['Modules']]
    has_sg=any('shieldgenerator' in i for i in its); has_fs=any('fuelscoop' in i for i in its)
    nslot=100
    for kind,sz in sorted(ints,key=lambda x:-x[1]):
        nslot+=1
        if kind=='mil': it=gsr(sz);sl=f'military0{nslot-100}'
        else:
            sl=f'slot{nslot}_size{sz}'
            if not has_sg: it=shieldgen(sz);has_sg=True
            elif not has_fs and r!='combat': it=f'int_fuelscoop_size{sz}_class5' if items[f'int_fuelscoop_size{sz}_class5'] else best(lambda i: i.startswith('int_fuelscoop_size') and int(re.search(r'size(\d)',i).group(1))<=sz);has_fs=True
            elif r=='combat': it=hrp(sz)
            else: it=cargo(sz)
        added.append({'Slot':sl,'Item':it,'On':True,'Filled':True})
    s['Modules']+=added
    report.append((s['ShipName'],r,[a['Item'].replace('hpt_','').replace('int_','') for a in added]))
json.dump(fleet,open('fleet-filled.json','w'),indent=1)
for n,r,a in report:
    c=collections.Counter(a);print(f"{n} [{r}] +{len(a)}: "+', '.join(f'{v}x {k}' for k,v in c.items()))
print('WEAP',WEAP)
