/** Important alerts are separate from chat and never request Android full-screen intent. */
export function validateImportantAlert({title='',body=''}={}){
  const cleanTitle=String(title).trim();
  const cleanBody=String(body).trim();
  if(cleanTitle.length>120)throw Error('Titolo troppo lungo (massimo 120 caratteri).');
  if(!cleanBody||cleanBody.length>750)throw Error('Scrivi un messaggio (massimo 750 caratteri).');
  return {title:cleanTitle,body:cleanBody};
}
export function mountImportantAlertComposer({host,recipientName,onSend}){
  host.querySelector('#importantAlertComposer')?.remove();
  const shade=document.createElement('div');
  shade.id='importantAlertComposer';
  shade.className='important-alert-composer-shade';
  shade.setAttribute('role','dialog');
  shade.setAttribute('aria-modal','true');
  shade.setAttribute('aria-label','Invia avviso importante');
  const form=document.createElement('form');
  form.className='important-alert-composer';
  const heading=document.createElement('h2');
  heading.textContent='Invia avviso importante';
  const to=document.createElement('p');
  to.textContent='Destinatario: '+recipientName;
  const title=document.createElement('input');
  title.name='title';title.maxLength=120;title.placeholder='Titolo (facoltativo)';
  title.setAttribute('aria-label','Titolo avviso');
  const body=document.createElement('textarea');
  body.name='body';body.maxLength=750;body.required=true;body.rows=6;
  body.placeholder='Scrivi il testo dell’avviso';
  body.setAttribute('aria-label','Testo avviso');
  const help=document.createElement('p');help.className='important-alert-help';
  help.textContent='L’avviso apparirà a schermo intero quando FreePT è aperta. Su Android bloccato occorre toccare la notifica.';
  const state=document.createElement('p');state.setAttribute('role','status');state.className='important-alert-state';
  const buttons=document.createElement('div');buttons.className='important-alert-buttons';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Annulla';cancel.className='secondary';
  const send=document.createElement('button');send.type='submit';send.textContent='Invia avviso';
  cancel.onclick=()=>shade.remove();
  buttons.append(cancel,send);
  form.append(heading,to,title,body,help,state,buttons);
  shade.append(form);host.append(shade);
  shade.addEventListener('click',event=>{if(event.target===shade&&!send.disabled)shade.remove();});
  form.onsubmit=async event=>{
    event.preventDefault();
    let payload;
    try{payload=validateImportantAlert({title:title.value,body:body.value});}
    catch(error){state.textContent=error.message;return;}
    send.disabled=true;cancel.disabled=true;state.textContent='Invio in corso…';
    try{
      const result=await onSend(payload);
      state.textContent=result?.accepted>0
        ?'Avviso salvato e notificato a Firebase ('+result.accepted+' dispositivo/i).'
        :'Avviso salvato. Nessun dispositivo ha confermato l’accettazione della notifica; sarà visibile aprendo FreePT.';
      send.hidden=true;cancel.disabled=false;cancel.textContent='Chiudi';
    }catch(error){
      state.textContent='Invio non confermato: '+(error?.message||'errore')+'. Verifica prima di ripetere per evitare duplicati.';
      cancel.disabled=false;send.disabled=false;
    }
  };
  title.focus();
  return ()=>shade.remove();
}
export function renderImportantAlert({host,alert,onAcknowledge}){
  host.querySelector('#importantAlertScreen')?.remove();
  const shade=document.createElement('div');
  shade.id='importantAlertScreen';
  shade.className='important-alert-fullscreen';
  shade.setAttribute('role','dialog');shade.setAttribute('aria-modal','true');
  shade.setAttribute('aria-label','Avviso importante FreePT');
  const content=document.createElement('div');content.className='important-alert-fullscreen-content';
  const brand=document.createElement('p');brand.className='important-alert-brand';brand.textContent='FreePT · AVVISO IMPORTANTE';
  content.append(brand);
  if(alert.title){
    const title=document.createElement('h1');title.textContent=alert.title;content.append(title);
  }
  const body=document.createElement('p');body.className='important-alert-body';body.textContent=alert.body;
  const status=document.createElement('p');status.setAttribute('role','status');status.className='important-alert-state';
  // Closing is not an explicit read receipt. No 'Ho letto' confirmation.
  // Keep the server-side read_at field as an acknowledgement of dismissal only.
  const close=document.createElement('button');
  close.type='button';close.className='important-alert-close';
  close.setAttribute('aria-label','Chiudi avviso');close.textContent='×';
  close.onclick=async()=>{
    close.disabled=true;status.textContent='Chiusura…';
    try{await onAcknowledge(alert.id);shade.remove();}
    catch(error){status.textContent='Impossibile chiudere: '+(error?.message||'errore');close.disabled=false;}
  };
  content.append(close,body,status);shade.append(content);host.append(shade);close.focus();
  return ()=>shade.remove();
}
