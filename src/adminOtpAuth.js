/**
 * Passwordless administrator authentication via Supabase email OTP.
 * Never creates a user. Administrator approval is checked separately against
 * the trusted profiles row after verification.
 */
function validateEmail(value){
  const email=String(value??'').trim().toLowerCase();
  if(email.length>254||! /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))
    throw Error('admin_email_invalid');
  return email;
}
export async function sendAdminEmailCode(auth,emailInput){
  if(typeof auth?.signInWithOtp!=='function')throw Error('admin_auth_unavailable');
  const email=validateEmail(emailInput);
  const {error}=await auth.signInWithOtp({
    email,options:{shouldCreateUser:false}
  });
  if(error)throw Error('admin_code_delivery_failed');
  return email;
}
export async function verifyAdminEmailCode(auth,emailInput,codeInput){
  if(typeof auth?.verifyOtp!=='function')throw Error('admin_auth_unavailable');
  const email=validateEmail(emailInput);
  const token=String(codeInput??'').trim();
  if(!/^\\d{6}$/.test(token))throw Error('admin_code_invalid');
  const {data,error}=await auth.verifyOtp({email,token,type:'email'});
  if(error||!data?.user||data.user.is_anonymous)
    throw Error('admin_code_verification_failed');
  return data.user;
}
