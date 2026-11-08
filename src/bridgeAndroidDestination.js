/**
 * Android SAF destination adapter for atomic Bridge folder downloads.
 * The user explicitly chooses the destination in Android's folder picker.
 * Every write is confined to the private staging tree managed by the plugin.
 */
const safeName=name=>typeof name==='string'&&name.length>0&&name.length<=255&&
  name!=='.'&&name!=='..'&&!/[\\/\u0000-\u001f\u007f]/u.test(name);
const checkPath=path=>{
  if(!Array.isArray(path)||path.length<1||path.length>16||
     !path.every(safeName))throw Error('bridge_destination_invalid_path');
  return [...path];
};
export const encodeBridgeBytes=bytes=>{
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>32768)
    throw Error('bridge_destination_invalid_chunk');
  let raw='';
  for(let i=0;i<bytes.length;i+=8192)
    raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
};
export function createBridgeAndroidFolderDestination({plugin,name}={}){
  if(!safeName(name)||!plugin||
     ['beginFolder','makeDirectory','openFile','writeChunk','commitFile',
      'discardFile','commitFolder','discardFolder'].some(k=>typeof plugin[k]!=='function'))
    throw Error('bridge_destination_invalid_options');
  let active=false;
  return Object.freeze({
    async begin(){
      if(active)throw Error('bridge_destination_already_started');
      const result=await plugin.beginFolder({name});
      if(result?.started!==true)throw Error('bridge_destination_begin_invalid');
      active=true;
    },
    async makeDirectory(path){
      if(!active)throw Error('bridge_destination_not_started');
      await plugin.makeDirectory({path:checkPath(path)});
    },
    async openFile(path,{size,mime}={}){
      if(!active)throw Error('bridge_destination_not_started');
      if(!Number.isSafeInteger(size)||size<0||size>1024**4||
         typeof mime!=='string'||mime.length>160)
        throw Error('bridge_destination_invalid_metadata');
      const selected=await plugin.openFile({path:checkPath(path),size,mime});
      const fileId=selected?.fileId;
      if(typeof fileId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(fileId)))
        throw Error('bridge_destination_invalid_file_id');
      let finished=false;
      return {
        async write(bytes,offset){
          if(finished||!Number.isSafeInteger(offset)||offset<0)
            throw Error('bridge_destination_writer_closed');
          const result=await plugin.writeChunk({fileId,offset,base64:encodeBridgeBytes(bytes)});
          if(result?.written!==offset+bytes.length)
            throw Error('bridge_destination_write_mismatch');
        },
        async commit(){
          if(finished)throw Error('bridge_destination_writer_closed');
          await plugin.commitFile({fileId});
          finished=true;
        },
        async discard(){
          if(finished)return;
          finished=true;
          await plugin.discardFile({fileId});
        }
      };
    },
    async commit(){
      if(!active)throw Error('bridge_destination_not_started');
      await plugin.commitFolder();
      active=false;
    },
    async discard(){
      if(!active)return;
      await plugin.discardFolder();
      active=false;
    }
  });
}

/**
 * Direct single-file destination. The SAF plugin creates a temporary document
 * and renames it only after its expected byte count has been written.
 */
export async function createBridgeAndroidSingleFileWriter({plugin,name,size,mime}={}){
  if(!plugin||['beginSingleFile','writeChunk','commitFile','commitSingleFile',
     'discardSingleFile'].some(k=>typeof plugin[k]!=='function')||
     !safeName(name)||!Number.isSafeInteger(size)||size<0||size>1024**4||
     typeof mime!=='string'||mime.length>160)
    throw Error('bridge_single_file_destination_invalid');
  const opened=await plugin.beginSingleFile({name,size,mime});
  const fileId=opened?.fileId;
  if(typeof fileId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(fileId)))
    throw Error('bridge_destination_invalid_file_id');
  let closed=false;
  return Object.freeze({
    async write(bytes,offset){
      if(closed||!Number.isSafeInteger(offset)||offset<0)
        throw Error('bridge_destination_writer_closed');
      const result=await plugin.writeChunk({fileId,offset,base64:encodeBridgeBytes(bytes)});
      if(result?.written!==offset+bytes.length)
        throw Error('bridge_destination_write_mismatch');
    },
    async commit(){
      if(closed)throw Error('bridge_destination_writer_closed');
      await plugin.commitFile({fileId});
      await plugin.commitSingleFile();
      closed=true;
    },
    async discard(){
      if(closed)return;
      await plugin.discardSingleFile();
      closed=true;
    }
  });
}
