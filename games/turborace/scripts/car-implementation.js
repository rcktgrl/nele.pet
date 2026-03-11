import { getOpponentCarModels, getPlayerCarModel } from './car-model-code.js';

export function buildRaceGrid(trackPoints){
  const n=trackPoints.length;
  if(!n)return Array(5).fill({pos:new THREE.Vector3(0,0,0),hdg:0});
  const grid=[];
  const rows=[1,1,2,2,3];
  const cols=[-1,1,-1,1,0];
  const rowStep=16;
  const sideOff=2.6;
  for(let slot=0;slot<5;slot++){
    const idx=((n - rows[slot]*rowStep) % n + n) % n;
    const pt=trackPoints[idx];
    const ptF=trackPoints[(idx+5)%n];
    const hdg=Math.atan2(ptF.x-pt.x, ptF.z-pt.z);
    const right=new THREE.Vector3(Math.cos(hdg),0,-Math.sin(hdg));
    const pos=pt.clone().addScaledVector(right,cols[slot]*sideOff);
    grid.push({pos,hdg});
  }
  return grid;
}

export function instantiateRaceCars({ trackPoints, cars, selectedCarIndex, CarClass, createAIController }){
  const grid=buildRaceGrid(trackPoints);
  const playerCar=new CarClass(getPlayerCarModel(cars, selectedCarIndex),grid[0].pos,grid[0].hdg,true);

  const aiCars=[];
  const aiControllers=[];
  const aiModels=getOpponentCarModels(cars, selectedCarIndex,4);
  for(let i=0;i<4;i++){
    const aiCar=new CarClass(aiModels[i],grid[i+1].pos,grid[i+1].hdg,false);
    aiCar.aiAgg=.86+i*.04;
    aiCars.push(aiCar);
    aiControllers.push(createAIController(aiCar,i));
  }

  return { playerCar, aiCars, aiControllers, allCars:[playerCar,...aiCars] };
}
