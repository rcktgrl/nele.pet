function mat(c){return new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide});}
function matT(c,o){return new THREE.MeshLambertMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide});}
function matE(c,e){return new THREE.MeshLambertMaterial({color:c,emissive:e,side:THREE.DoubleSide});}

export { mat, matT, matE };