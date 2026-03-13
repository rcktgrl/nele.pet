function getNodeById(id){return researchNodes.find(n=>n.id===id)}
function getPrereqs(id){return researchEdges.filter(e=>e.to===id).map(e=>e.from)}
function canResearch(id){return getPrereqs(id).every(req=>metaProgress.researched[req])}
function isResearchScoreUnlocked(node){return !node.unlockScore || (metaProgress.bestRunScore||0) >= node.unlockScore}