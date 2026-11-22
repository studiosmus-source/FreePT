import {deflateSync} from 'node:zlib';
import {Buffer} from 'node:buffer';

const CRC_TABLE=Uint32Array.from({length:256},(_,index)=>{
  let value=index;
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
function crc32(buffer){
  let crc=0xffffffff;
  for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function pngChunk(type,data){
  const name=Buffer.from(type,'ascii');
  const body=Buffer.concat([name,data]);
  const size=Buffer.alloc(4),checksum=Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([size,body,checksum]);
}

/** Small self-contained tray icon; no downloaded or user-supplied asset. */
export function createBridgeTrayPng(){
  const size=24,raw=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++){
    const rowStart=y*(size*4+1);
    raw[rowStart]=0;
    for(let x=0;x<size;x++){
      const dx=x-11.5,dy=y-11.5;
      const inside=dx*dx+dy*dy<=10.5*10.5;
      let color=[0,0,0,0];
      if(inside)color=[31,150,105,255];
      const deck=y>=12&&y<=14&&x>=5&&x<=18;
      const pillar=(x===7||x===16)&&y>=13&&y<=18;
      const arch=(y>=8&&y<=12&&x>=8&&x<=15&&
        Math.abs(y-(8+Math.round(Math.abs(x-11.5)*0.55)))<=1);
      if(inside&&(deck||pillar||arch))color=[255,255,255,255];
      const offset=rowStart+1+x*4;
      raw.set(color,offset);
    }
  }
  const header=Buffer.alloc(13);
  header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);
  header[8]=8;header[9]=6;header[10]=0;header[11]=0;header[12]=0;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(raw)),
    pngChunk('IEND',Buffer.alloc(0))
  ]);
}
