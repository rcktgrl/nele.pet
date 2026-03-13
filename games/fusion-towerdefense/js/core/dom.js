let researchNodes=[];
let researchEdges=[];
let devSelectedNodeIds=[];
let devDraggingId=null;
let devDragOffset={x:0,y:0};
let researchViewOffset={x:0,y:0};
let devViewOffset={x:0,y:0};
let researchPanning=false;
let devPanning=false;
let researchPanLast={x:0,y:0};
let devPanLast={x:0,y:0};
const screens={
  mainMenu:document.getElementById('mainMenu'),
  mapMenu:document.getElementById('mapMenu'),
  researchMenu:document.getElementById('researchMenu'),
  devResearchMenu:document.getElementById('devResearchMenu'),
  cardLoadoutMenu:document.getElementById('cardLoadoutMenu'),
  gameScreen:document.getElementById('gameScreen')
};
const canvas=document.getElementById('gameCanvas'),ctx=canvas.getContext('2d');
const ui={moneyValue:document.getElementById('moneyValue'),scoreValue:document.getElementById('scoreValue'),livesValue:document.getElementById('livesValue'),waveValue:document.getElementById('waveValue'),topInfo:document.getElementById('topInfo'),topSubInfo:document.getElementById('topSubInfo'),towerList:document.getElementById('towerList'),statusLine:document.getElementById('statusLine'),waveLimitInput:document.getElementById('waveLimitInput'),terrainInput:document.getElementById('terrainInput'),pathLengthInput:document.getElementById('pathLengthInput'),enemyCountInput:document.getElementById('enemyCountInput'),menuWaveLimit:document.getElementById('menuWaveLimit'),settingsWaveLimit:document.getElementById('settingsWaveLimit'),settingsPathLength:document.getElementById('settingsPathLength'),settingsEnemyCount:document.getElementById('settingsEnemyCount'),mapPreviewText:document.getElementById('mapPreviewText'),scoreMultValue:document.getElementById('scoreMultValue'),selectedTowerStats:document.getElementById('selectedTowerStats'),metaCashValue:document.getElementById('metaCashValue'),researchCountValue:document.getElementById('researchCountValue'),researchStatusText:document.getElementById('researchStatusText'),mainMetaCash:document.getElementById('mainMetaCash'),menuTowerCount:document.getElementById('menuTowerCount'),wavePreviewList:document.getElementById('wavePreviewList'),cardLoadoutSlots:document.getElementById('cardLoadoutSlots'),cardPoolGrid:document.getElementById('cardPoolGrid'),cardSearchInput:document.getElementById('cardSearchInput'),unlockCardSlotBtn:document.getElementById('unlockCardSlotBtn')};
