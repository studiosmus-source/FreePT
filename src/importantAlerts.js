/** Important alerts are separate from chat and never request Android full-screen intent. */
const RELEASE_URL=/^https:\/\/github\.com\/studiosmus-source\/FreePT\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.apk$/;
const RELEASE_SHA=/^[a-f0-9]{64}$/i;
export function validateAlertApkAttachment(value){
  if(value==null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Allegato APK non valido.');
  const {url,sha256,versionCode,versionName}=value;
  if(typeof url!=='string'||!RELEASE_URL.test(url)||typeof sha256!=='string'||!RELEASE_SHA.test(sha256)||
    !Number.isSafeInteger(versionCode)||versionCode<=0||versionCode>2147483647||
    typeof versionName!=='string'||!/^\d+\.\d+\.\d+$/.test(versionName))
    throw Error('Allegato APK: servono link GitHub Release, SHA-256 e versione validi.');
  return {url,sha256:sha256.toLowerCase(),versionCode,versionName};
}
export function validateImportantAlert({title='',body='',apk=null}={}){
  const cleanTitle=String(title).trim();
  const cleanBody=String(body).trim();
  if(cleanTitle.length>120)throw Error('Titolo troppo lungo (massimo 120 caratteri).');
  if(!cleanBody||cleanBody.length>750)throw Error('Scrivi un messaggio (massimo 750 caratteri).');
  const attachment=validateAlertApkAttachment(apk);
  return attachment?{title:cleanTitle,body:cleanBody,apk:attachment}:{title:cleanTitle,body:cleanBody};
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
  const attach=document.createElement('input');attach.type='checkbox';attach.id='importantAlertApk';
  const attachLabel=document.createElement('label');attachLabel.htmlFor='importantAlertApk';
  attachLabel.textContent=' Allega aggiornamento APK FreePT verificato';
  attachLabel.prepend(attach);
  const apkFields=document.createElement('div');apkFields.hidden=true;apkFields.className='important-alert-apk-fields';
  const apkUrl=document.createElement('input');apkUrl.type='url';apkUrl.placeholder='Link APK GitHub Release';apkUrl.setAttribute('aria-label','Link APK GitHub Release');
  const apkSha=document.createElement('input');apkSha.placeholder='SHA-256 del file APK';apkSha.setAttribute('aria-label','SHA-256 APK');
  const apkVersion=document.createElement('input');apkVersion.placeholder='Versione (es. 2.3.0)';apkVersion.setAttribute('aria-label','Versione APK');
  const apkCode=document.createElement('input');apkCode.type='number';apkCode.min='1';apkCode.placeholder='Codice versione Android';apkCode.setAttribute('aria-label','Codice versione APK');
  apkFields.append(apkUrl,apkSha,apkVersion,apkCode);
  attach.onchange=()=>{apkFields.hidden=!attach.checked;};
  const help=document.createElement('p');help.className='important-alert-help';
  help.textContent='L’avviso apparirà a schermo intero quando FreePT è aperta. Su Android bloccato occorre toccare la notifica.';
  const state=document.createElement('p');state.setAttribute('role','status');state.className='important-alert-state';
  const buttons=document.createElement('div');buttons.className='important-alert-buttons';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Annulla';cancel.className='secondary';
  const send=document.createElement('button');send.type='submit';send.textContent='Invia avviso';
  cancel.onclick=()=>shade.remove();
  buttons.append(cancel,send);
  form.append(heading,to,title,body,attachLabel,apkFields,help,state,buttons);
  shade.append(form);host.append(shade);
  shade.addEventListener('click',event=>{if(event.target===shade&&!send.disabled)shade.remove();});
  form.onsubmit=async event=>{
    event.preventDefault();
    let payload;
    try{payload=validateImportantAlert({title:title.value,body:body.value,
      apk:attach.checked?{url:apkUrl.value.trim(),sha256:apkSha.value.trim(),versionName:apkVersion.value.trim(),versionCode:Number(apkCode.value)}:null});}
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
export function renderImportantAlert({host,alert,onAcknowledge,updater=null}){
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
  if(alert.apk){
    const attachment=document.createElement('div');attachment.className='important-alert-apk-attachment';
    const name=document.createElement('strong');name.textContent='📦 FreePT '+alert.apk.versionName+' · aggiornamento APK';
    const install=document.createElement('button');install.type='button';install.textContent='Avvia aggiornamento';
    install.onclick=async()=>{
      if(!updater){status.textContent='Aggiornamento disponibile solo nell’app Android compatibile.';return;}
      install.disabled=true;status.textContent='Verifica e download…';
      try{
        const outcome=await updater.downloadAndInstall(validateAlertApkAttachment(alert.apk),{
          onProgress:percent=>{status.textContent='Download aggiornamento… '+Math.round(percent)+'%';}
        });
        status.textContent=outcome?.needsPermission
          ?'Autorizza l’installazione aggiornamenti nelle impostazioni Android, poi riprova.'
          :'Conferma l’installazione nella schermata Android.';
      }catch(error){status.textContent='Aggiornamento non riuscito: '+(error?.message||'errore');}
      finally{install.disabled=false;}
    };
    attachment.append(name,install);content.append(attachment);
  }
  content.append(close,body,status);shade.append(content);host.append(shade);close.focus();
  return ()=>shade.remove();
}
