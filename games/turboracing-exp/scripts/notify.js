'use strict';

let ntTO=null;
export function notify(txt){
  const el=document.getElementById('notif');
  el.innerHTML=txt; el.style.display='block';
  el.style.opacity='0'; el.style.transition='none'; el.offsetHeight;
  el.style.transition='opacity .22s'; el.style.opacity='1';
  if(ntTO)clearTimeout(ntTO);
  ntTO=setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.style.display='none',300);},2400);
}
globalThis.notify=notify;
