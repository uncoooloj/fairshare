import {configuredMailTransport} from './mail.js';
import {PayPalSandbox} from '@fairshare/payments';
import {buildApp} from './app.js';
if(process.env.PAYPAL_ENV==='live')throw new Error('Fairshare supports sandbox only.');
const provider=process.env.DEMO_MODE!=='true'&&process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET&&process.env.PAYPAL_MERCHANT_ID?new PayPalSandbox({clientId:process.env.PAYPAL_CLIENT_ID,clientSecret:process.env.PAYPAL_CLIENT_SECRET,webhookId:process.env.PAYPAL_WEBHOOK_ID,merchantId:process.env.PAYPAL_MERCHANT_ID,payoutsEnabled:process.env.PAYPAL_PAYOUTS_ENABLED==='true',payoutsEligibilityConfirmed:process.env.PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED==='true'}):undefined;
const mailTransport=configuredMailTransport();
const app=await buildApp({mailTransport,publicAppOrigin:process.env.PUBLIC_APP_ORIGIN,demo:process.env.DEMO_MODE==='true',logger:false,payment:{provider,publicOrigin:process.env.PUBLIC_API_URL},ai:{accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN,model:process.env.CLOUDFLARE_AI_MODEL}});
await app.listen({host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??3001)});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close();});
