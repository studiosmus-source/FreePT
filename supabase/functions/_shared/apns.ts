/**
 * FreePT iOS APNs delivery. Only called by authenticated server-side Edge Functions.
 * No Apple signing keys, device identifiers, or private message text in client apps.
 */
import {importPKCS8,SignJWT} from 'npm:jose@5';

export function isApplePushConfigured(){
  return !!(Deno.env.get('APNS_TEAM_ID')&&Deno.env.get('APNS_KEY_ID')&&
    Deno.env.get('APNS_PRIVATE_KEY')&&Deno.env.get('APNS_BUNDLE_ID'));
}
export async function sendApns({deviceToken,title,body,data={}}:{
  deviceToken:string;title:string;body:string;data?:Record<string,string>;
}):Promise<{accepted:boolean;expired:boolean;status:number}>{
  if(!isApplePushConfigured())throw Error('apns_not_configured');
  if(!/^[a-f0-9]{64}$/i.test(deviceToken))return {accepted:false,expired:true,status:400};
  const team=Deno.env.get('APNS_TEAM_ID')!,kid=Deno.env.get('APNS_KEY_ID')!;
  const privateKey=Deno.env.get('APNS_PRIVATE_KEY')!.replace(/\\n/g,'\n');
  const topic=Deno.env.get('APNS_BUNDLE_ID')!;
  const sandbox=Deno.env.get('APNS_ENVIRONMENT')!=='production';
  const key=await importPKCS8(privateKey,'ES256');
  const token=await new SignJWT({})
    .setProtectedHeader({alg:'ES256',kid}).setIssuer(team)
    .setIssuedAt().sign(key);
  const url='https://'+(sandbox?'api.sandbox.push.apple.com':'api.push.apple.com')+
    '/3/device/'+deviceToken;
  const response=await fetch(url,{
    method:'POST',
    headers:{
      authorization:'bearer '+token,
      'apns-topic':topic,
      'apns-push-type':'alert',
      'apns-priority':'10',
      'content-type':'application/json'
    },
    body:JSON.stringify({
      aps:{alert:{title,body},sound:'default'},
      ...data
    })
  });
  return {accepted:response.status===200,expired:response.status===410,status:response.status};
}
