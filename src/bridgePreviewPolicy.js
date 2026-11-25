// Receiver-only decisions. Never change the remote catalogue or permissions.
export const IMAGE_PREVIEW_LIMIT=8*1024*1024;
export const PDF_PREVIEW_LIMIT=2*1024*1024;
const types={
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',
  pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',
  m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',txt:'text/plain',
  csv:'text/csv',log:'text/plain',json:'application/json',xml:'application/xml'
};
export function bridgePreviewPolicy(item){
  if(!item||item.directory||!Number.isSafeInteger(item.size)||item.size<=0)return null;
  let mime=String(item.mime||'').split(';')[0].trim().toLowerCase();
  // Some Android providers return only application/octet-stream.
  if(!mime||['application/octet-stream','binary/octet-stream'].includes(mime)){
    mime=types[String(item.name||'').split('.').pop().toLowerCase()]||mime;
  }
  let kind,limit;
  if(['image/jpeg','image/png','image/gif','image/webp'].includes(mime)){
    kind='image';limit=IMAGE_PREVIEW_LIMIT;
  }else if(mime==='application/pdf'){
    kind='pdf';limit=PDF_PREVIEW_LIMIT;
  }else if(['video/mp4','video/webm'].includes(mime)){
    kind='video';limit=IMAGE_PREVIEW_LIMIT;
  }else if(['audio/mpeg','audio/mp4','audio/wav','audio/ogg'].includes(mime)){
    kind='audio';limit=IMAGE_PREVIEW_LIMIT;
  }else if(['text/plain','text/csv','text/xml','application/json','application/xml'].includes(mime)){
    kind='text';limit=PDF_PREVIEW_LIMIT;
  }else return null;
  // Large JPEGs can still contain a small embedded EXIF thumbnail.
  if(item.size>limit&&mime!=='image/jpeg')return null;
  return {kind,mime,limit,embeddedOnly:item.size>limit};
}
