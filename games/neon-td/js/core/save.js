function loadMeta(){try{let raw=localStorage.getItem(SAVE_KEY);let migrated=false;if(!raw){const legacyRaw=localStorage.getItem('neon_td_meta_v5');if(legacyRaw){const legacy=JSON.parse(legacyRaw);const legacyResearched={...(legacy.researched||{})};legacyResearched.basic_upgrade=false;legacyResearched.shotgun_upgrade=false;legacyResearched.duo_upgrade=false;legacyResearched.sniper_upgrade=false;legacyResearched.rapid_upgrade=false;raw=JSON.stringify({cash:legacy.cash||0,bestRunScore:legacy.bestRunScore||0,researched:legacyResearched});migrated=true}}if(!raw)return;const d=JSON.parse(raw);metaProgress.cash=d.cash||0;metaProgress.bestRunScore=d.bestRunScore||0;metaProgress.researched={...metaProgress.researched,...(d.researched||{})};if(migrated)saveMeta()}catch(e){} }
function saveMeta(){localStorage.setItem(SAVE_KEY,JSON.stringify(metaProgress))}
function loadTreeConfig(){
  try{
    const raw=localStorage.getItem(TREE_SAVE_KEY);
    if(raw){
      const data=JSON.parse(raw);
      const savedNodes=(data.nodes||[]).map(n=>({...n}));
      const savedEdges=(data.edges||[]).map(e=>({...e}));

      const nodeMap=new Map(savedNodes.map(n=>[n.id,n]));
      for(const def of DEFAULT_RESEARCH_NODES){
        if(!nodeMap.has(def.id)) nodeMap.set(def.id,{...def});
      }
      researchNodes=[...nodeMap.values()];

      const edgeKey=e=>`${e.from}->${e.to}`;
      const edgeMap=new Map(savedEdges.map(e=>[edgeKey(e),e]));
      for(const def of DEFAULT_RESEARCH_EDGES){
        const k=edgeKey(def);
        if(!edgeMap.has(k)) edgeMap.set(k,{...def});
      }
      researchEdges=[...edgeMap.values()];
      return;
    }
  }catch(e){}
  researchNodes=DEFAULT_RESEARCH_NODES.map(n=>({...n}));
  researchEdges=DEFAULT_RESEARCH_EDGES.map(e=>({...e}));
}
function saveTreeConfig(){localStorage.setItem(TREE_SAVE_KEY,JSON.stringify({nodes:researchNodes,edges:researchEdges}))}