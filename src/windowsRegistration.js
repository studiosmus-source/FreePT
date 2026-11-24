/** FreePT Windows registration is opt-in by origin; Android stays phone-only. */
export const isWindowsFreePT=()=>typeof window!=='undefined'&&window.location?.hostname==='app.freept.test';
export function normalizedWindowsEmail(value){
 const email=String(value??'').trim().toLowerCase();
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
   throw Error('Inserisci un indirizzo email valido.');
 return email;
}
