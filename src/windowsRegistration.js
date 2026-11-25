/** FreePT Windows registration is opt-in by origin; Android stays phone-only. */
export const isWindowsFreePT=()=>typeof window!=='undefined'&&window.location?.hostname==='app.freept.test';
export function normalizedWindowsEmail(value){
 const email=String(value??'').trim().toLowerCase();
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
   throw Error('Inserisci un indirizzo email valido.');
 return email;
}

/**
 * One-time code from the administrator ("Codice per il PC"): opens the SAME
 * FreePT account as the person's phone. Format ABCDEF-12345678 (6 letters or
 * digits without 0/O/1/I/L, then the 6-10 digit one-time password).
 */
export function parsePcAccessCode(value){
 const raw=String(value??'').toUpperCase().replace(/[\s.·_]/g,'').replace(/[–—]/g,'-');
 const match=/^([A-HJKMNP-Z2-9]{6})-?([0-9]{6,10})$/.exec(raw);
 if(!match)throw Error('Codice non valido: controlla di averlo scritto come te l’ha dato l’amministratore.');
 return {email:'pc-'+match[1].toLowerCase()+'@freept-pc.invalid',token:match[2]};
}
