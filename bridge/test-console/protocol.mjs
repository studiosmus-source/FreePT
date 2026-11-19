/** WebCrypto IEEE-P1363 signature -> the Android/Node DER wire format. */
export function derSignature(raw){
 if(!(raw instanceof Uint8Array)||raw.length!==64)throw Error('Invalid P256 signature');
 const integer=bytes=>{let i=0;while(i<bytes.length-1&&bytes[i]===0)i++;let b=Array.from(bytes.slice(i));if(b[0]&128)b.unshift(0);return [2,b.length,...b];};
 const content=[...integer(raw.slice(0,32)),...integer(raw.slice(32))];return new Uint8Array([48,content.length,...content]);
}
export function fixtureBytes(challenge,offset,length){
 if(!/^[0-9a-f]{64}$/.test(challenge)||!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<1||length>262144||offset+length>300000)throw Error('Invalid fixture');
 const seed=challenge.match(/../g).map(x=>parseInt(x,16));return Uint8Array.from({length},(_,i)=>seed[(offset+i)%32]^((offset+i)&255));
}
