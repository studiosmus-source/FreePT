/**
 * In-app chat attachment rendering: thumbnails, fullscreen image/video, PDF and
 * document opening, and a download-to-folder that confirms only after the file
 * is actually written. No photo ever forces Chrome open.
 *
 * Pure helpers (kind inference) are unit-tested; the renderer takes injected
 * helpers (signed-url maker, destination plugin, escaper) so it stays testable
 * and does not hard-depend on Supabase or Capacitor at import time.
 */
const IMAGE=new Set(['jpg','jpeg','png','gif','webp','bmp','heic','heif','avif']);
const VIDEO=new Set(['mp4','webm','mov','m4v','3gp','mkv']);
const AUDIO=new Set(['mp3','m4a','aac','ogg','opus','wav','flac']);
const PDF=new Set(['pdf']);

export function attachmentExtension(fileName){
  const name=typeof fileName==='string'?fileName:'';
  const dot=name.lastIndexOf('.');
  if(dot<0||dot===name.length-1)return '';
  return name.slice(dot+1).toLowerCase();
}
export function attachmentKind(fileName){
  const ext=attachmentExtension(fileName);
  if(IMAGE.has(ext))return 'image';
  if(VIDEO.has(ext))return 'video';
  if(AUDIO.has(ext))return 'audio';
  if(PDF.has(ext))return 'pdf';
  return 'other';
}
export function attachmentMime(fileName){
  const ext=attachmentExtension(fileName);
  const map={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
    webp:'image/webp',bmp:'image/bmp',heic:'image/heic',heif:'image/heif',avif:'image/avif',
    mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/x-m4v',
    '3gp':'video/3gpp',mkv:'video/x-matroska',
    mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',
    wav:'audio/wav',flac:'audio/flac',pdf:'application/pdf'};
  return map[ext]||'application/octet-stream';
}
