/**
 * Extract the JPEG thumbnail embedded in standard EXIF IFD1 metadata.
 * Only examines an already-authorized, bounded file prefix in memory.
 * No external URLs, file paths, storage permissions or decompression.
 */
export function extractEmbeddedJpegThumbnail(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<16||
     bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  const limit=bytes.length;
  const read16be=p=>p>=0&&p+2<=limit?(bytes[p]<<8)|bytes[p+1]:null;
  let p=2;
  while(p+4<=limit){
    if(bytes[p++]!==0xff)return null;
    while(p<limit&&bytes[p]===0xff)p++;
    if(p>=limit)return null;
    const marker=bytes[p++];
    if(marker===0xda||marker===0xd9)return null; // SOS/EOI: metadata ends
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    const length=read16be(p);
    if(length===null||length<2||p+length>limit)return null;
    const start=p+2,end=p+length;
    p=end;
    if(marker!==0xe1||end-start<14||
       bytes[start]!==69||bytes[start+1]!==120||
       bytes[start+2]!==105||bytes[start+3]!==102||
       bytes[start+4]!==0||bytes[start+5]!==0)continue;
    const t=start+6;
    const little=bytes[t]===73&&bytes[t+1]===73;
    const big=bytes[t]===77&&bytes[t+1]===77;
    if(!little&&!big)continue;
    const available=end;
    const u16=q=>{
      if(q<t||q+2>available)return null;
      return little?(bytes[q]|(bytes[q+1]<<8)):((bytes[q]<<8)|bytes[q+1]);
    };
    const u32=q=>{
      if(q<t||q+4>available)return null;
      const value=little?
        ((bytes[q])|(bytes[q+1]<<8)|(bytes[q+2]<<16)|(bytes[q+3]<<24)):
        ((bytes[q]<<24)|(bytes[q+1]<<16)|(bytes[q+2]<<8)|bytes[q+3]);
      return value>>>0;
    };
    if(u16(t+2)!==42)continue;
    const ifd0offset=u32(t+4);
    if(ifd0offset===null||ifd0offset>available-t-2)continue;
    const ifd0=t+ifd0offset;
    const count0=u16(ifd0);
    if(count0===null||count0>512||ifd0+2+count0*12+4>available)continue;
    const ifd1offset=u32(ifd0+2+count0*12);
    if(!ifd1offset||ifd1offset>available-t-2)continue;
    const ifd1=t+ifd1offset;
    const count1=u16(ifd1);
    if(count1===null||count1>512||ifd1+2+count1*12>available)continue;
    let offset=null,size=null;
    for(let i=0;i<count1;i++){
      const entry=ifd1+2+i*12;
      if(u16(entry+2)!==4||u32(entry+4)!==1)continue; // LONG / count 1
      const tag=u16(entry);
      if(tag===0x0201)offset=u32(entry+8);
      if(tag===0x0202)size=u32(entry+8);
    }
    if(offset===null||size===null||size<4||size>262144||
       offset>available-t||size>available-t-offset)continue;
    const q=t+offset,z=q+size;
    if(bytes[q]!==0xff||bytes[q+1]!==0xd8||
       bytes[z-2]!==0xff||bytes[z-1]!==0xd9)continue;
    return bytes.slice(q,z);
  }
  return null;
}
