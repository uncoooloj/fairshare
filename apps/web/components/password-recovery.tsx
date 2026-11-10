"use client";
import {useEffect,useRef,useState} from 'react';
import {useEmailDelivery} from '../lib/email-capability';
import {api} from '../lib/model';
import styles from './designer-auth.module.css';
export function PasswordRecovery({reset=false}:{reset?:boolean}){
 const emailDelivery=useEmailDelivery();
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
 const pending=useRef(false),captured=useRef(false);
 useEffect(()=>{if(reset&&!captured.current){captured.current=true;setToken(new URLSearchParams(window.location.hash.slice(1)).get('token')||'');window.history.replaceState(null,'',window.location.pathname);}},[reset]);
 return <main className={styles.page}><div className={styles.column}>
  <h1>{reset?'Choose a new password':'Reset your password'}</h1>
  <p className={styles.subtitle}>{reset?'Your reset link can be used once. All signed-in sessions will be signed out.':emailDelivery?'Enter your verified account email. We will request a secure reset link.':'Email password recovery is unavailable in this environment. If you are still signed in, change your password in Settings → Profile. We cannot provide a reset link without verifying account ownership.'}</p>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}
  {!done&&(reset||emailDelivery)&&<form className={styles.form} aria-busy={busy} onSubmit={async event=>{
   event.preventDefault();if(pending.current)return;
   const data=new FormData(event.currentTarget);setError('');
   if(reset&&data.get('password')!==data.get('confirm')){setError('Passwords do not match.');return;}
   if(reset&&!/^[A-Za-z0-9_-]{43}$/.test(token)){setError('This reset link is missing or invalid. Request a new link.');return;}
   pending.current=true;setBusy(true);
   try{const result=await api(`auth/password-reset/${reset?'confirm':'request'}`,'POST',reset?{token,password:String(data.get('password'))}:{email:String(data.get('email')).trim()});setNotice(reset?'Password updated. Sign in with your new password.':result.notice);setDone(true);setToken('');}
   catch(e){setError(e instanceof Error?e.message:'Unable to complete the request. Try again.');}
   finally{pending.current=false;setBusy(false);}
  }}>
   {reset?<><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy}/></label><label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required disabled={busy}/></label></>:<label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy}/></label>}
   <button className={styles.primary} disabled={busy}>{busy?(reset?'Saving…':'Requesting… this can take 16 seconds'):reset?'Save new password':'Request reset link'}</button>
  </form>}
  <p><a href="/">Back to sign in</a>{reset&&<> · <a href="/forgot-password">Request a new link</a></>}</p>
 </div></main>;
}
