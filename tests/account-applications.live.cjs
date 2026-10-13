// Non-mutating live smoke checks. Uses only the existing public browser key.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../frontend/js/supabaseClient.js'),'utf8');
const key=source.match(/const SUPABASE_ANON_KEY =[\s\S]*?\n  "([^"]+)"/)[1];
const url=source.match(/const SUPABASE_URL =[\s\S]*?\n  "([^"]+)"/)[1];
(async()=>{
 const headers={Authorization:'Bearer '+key,apikey:key,'Content-Type':'application/json'};
 let response=await fetch(url+'/functions/v1/submit-account-application',{method:'POST',headers,body:JSON.stringify({action:'barangays'})});
 assert.equal(response.status,200);const {barangays}=await response.json();assert.ok(barangays.length>0);assert.ok(barangays.every(row=>Object.keys(row).sort().join(',')==='id,name'));
 console.log('PASS: live public picker returns '+barangays.length+' active barangays, no account data.');
 response=await fetch(url+'/functions/v1/review-account-application',{method:'POST',headers,body:JSON.stringify({application_id:'11111111-1111-4111-8111-111111111111',action:'approve'})});
 assert.equal(response.status,403);console.log('PASS: anonymous caller cannot approve accounts.');
 response=await fetch(url+'/rest/v1/account_applications?select=id',{headers});assert.ok([401,403].includes(response.status));console.log('PASS: anonymous caller cannot read application records.');
 response=await fetch(url+'/storage/v1/object/public/account-application-proofs/anything.pdf',{headers});assert.ok(!response.ok);console.log('PASS: application proof bucket is not public.');
})().catch(error=>{console.error(error);process.exitCode=1;});
