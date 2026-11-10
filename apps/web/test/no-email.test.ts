import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=(file:string)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('email controls require confirmed server capability, failing closed',()=>{
 assert.match(source('lib/email-capability.ts'),/useState\(false\)/);
 assert.match(source('lib/email-capability.ts'),/auth\/capabilities/);
 assert.match(source('components/designer-auth.tsx'),/login && emailDelivery/);
 assert.match(source('components/profile-contact.tsx'),/emailDelivery&&changing/);
 assert.match(source('components/password-recovery.tsx'),/reset\|\|emailDelivery/);
 assert.match(source('components/fairshare-app.tsx'),/emailDelivery && <Button/);
});
test('review reminders copy locally and notification preferences are in-app only',()=>{
 const reminder=source('components/review-discussion.tsx').split('export function ReviewReminder')[1];
 assert.match(reminder,/navigator.clipboard.writeText/);
 assert.match(reminder,/Review reminder to copy/);
 assert.doesNotMatch(reminder,/\/reminders|api\(/);
 assert.match(source('components/settings-preferences.tsx'),/\(\['inApp'\] as const\)/);
 assert.doesNotMatch(source('components/settings-preferences.tsx'),/<th scope="col">Email/);
});
