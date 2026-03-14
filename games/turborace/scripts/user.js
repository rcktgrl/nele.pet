import { supabase } from "./supabase";

let currentArcadeUser={ user_id:null, name:'Anonymous' };

export function sanitizeUserId(raw){
  const value=String(raw||'').trim();
  return value||null;
}

export function sanitizeLeaderboardName(raw){
  const cleaned=String(raw||'').trim().replace(/\s+/g,' ').slice(0,24);
  return cleaned||'Anonymous';
}

export async function loadArcadeUser(){
  try{
    const cached=JSON.parse(localStorage.getItem('arcade_user')||'null');
    if(cached&&sanitizeUserId(cached.user_id)){
      currentArcadeUser={ user_id:sanitizeUserId(cached.user_id), name:sanitizeLeaderboardName(cached.name) };
      return currentArcadeUser;
    }
  }catch(error){
    console.warn('Could not parse cached arcade user',error);
  }

  const { data }=await supabase.auth.getSession();
  const user=data?.session?.user;
  if(!user){
    currentArcadeUser={ user_id:null, name:'Anonymous' };
    return currentArcadeUser;
  }
  const guessedName=sanitizeLeaderboardName(user.user_metadata?.username || user.email?.split('@')[0] || 'Player');
  currentArcadeUser={ user_id:sanitizeUserId(user.id), name:guessedName };
  localStorage.setItem('arcade_user', JSON.stringify(currentArcadeUser));
  return currentArcadeUser;
}