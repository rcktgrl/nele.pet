import json,re,collections
CD='/home/user/edcd/coriolis-data/ships/'
MAP={'mandalay':'mandalay','type8':'type_8_transport','ferdelance':'fer_de_lance','cobramkv':'cobra_mk_v','panthermkii':'panther_clipper','lakonminer':'type_11_prospector','diamondbackxl':'diamondback_explorer','sidewinder':'sidewinder','eagle':'eagle','anaconda':'anaconda','asp':'asp','cobramkiii':'cobra_mk_iii','python':'python','vulture':'vulture','krait_mkii':'krait_mkii','mamba':'mamba','type9':'type_9_heavy','cobramkiv':'cobra_mk_iv','adder':'adder','belugaliner':'beluga','type6':'type_6_transporter','viper':'viper','type9_military':'type_10_defender','federation_corvette':'federal_corvette','python_nx':'python_nx','explorer_nx':'explorer_nx'}
HP={'huge':4,'large':3,'medium':2,'small':1,'tiny':0}
def layout(ship):
    f=MAP.get(ship.lower())
    if not f: return None
    d=json.load(open(CD+f+'.json'));s=list(d.values())[0]['slots']
    hp=collections.Counter(x['class'] if isinstance(x,dict) else x for x in s['hardpoints'])
    inl=[];
    for x in s['internal']:
        if isinstance(x,dict):
            if x.get('name')=='Military': inl.append(('mil',x['class']))
            # skip PlanetaryApproachSuite
        else: inl.append(('int',x))
    return hp,inl
def empties(sh):
    L=layout(sh['Ship'])
    if not L: return None
    hp,inl=L
    used_hp=collections.Counter();used_int=[]
    for m in sh['Modules']:
        sl=m['Slot'].lower()
        mm=re.match(r'(huge|large|medium|small|tiny)hardpoint',sl)
        if mm: used_hp[HP[mm.group(1)]]+=1;continue
        mm=re.match(r'slot\d+_size(\d+)',sl)
        if mm: used_int.append(('int',int(mm.group(1))));continue
        mm=re.match(r'military\d+',sl)
        if mm: used_int.append(('mil',None))
    emp_hp=hp-used_hp
    # internals: match used to layout by (kind,size)
    free=list(inl)
    for k,sz in used_int:
        for i,(fk,fs) in enumerate(free):
            if fk==k and (sz is None or fs==sz): free.pop(i);break
    return dict(emp_hp),free
if __name__=='__main__':
    fleet=json.load(open('fleet.json'))
    for s in fleet:
        e=empties(s)
        print(s['ShipName'],s['Ship'],'->', e if e else 'NO LAYOUT')
