"use client";
import {useEffect,useState} from 'react';
import {api} from '../../lib/model';
import {Button} from '../../components/ui';
export default function ChangeEmail(){
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setToken(new URLSearchParams(location.hash.slice(1)).get('token')??'');history.replaceState(null,'',location.pathname);},[]);
 return <main className="panel" style={{maxWidth:560,margin:'80px auto',padding:32}}><h1>Confirm your new email</h1><p>Stay signed in to the account that requested this change. Confirming verifies your new address and signs out every session.</p>{!done&&<Button disabled={busy||!token} onClick={async()=>{setBusy(true);setError('');try{await api('auth/email-change/confirm','POST',{token});setToken('');setDone(true);}catch(e){setError(e instanceof Error?e.message:'Verification failed.');}finally{setBusy(false);}}}>{busy?'Confirming…':'Confirm email change'}</Button>}{done&&<p role="status">Email changed. Sign in with your new email and existing password.</p>}{error&&<p role="alert">{error}</p>}{!token&&!done&&<p>Open the verification link from your email.</p>}<p><a href="/">Return to Fairshare</a></p></main>;
}
