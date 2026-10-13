const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');
const html=fs.readFileSync(path.resolve(__dirname,'../frontend/secretary.html'),'utf8');
const source=html.slice(html.indexOf('function displayStatus('),html.indexOf('async function init()',html.indexOf('function displayStatus(')));
const context=vm.createContext({});vm.runInContext(source,context);
const deadline='2026-10-03T17:00:00+08:00';
function status(time,band='grace_period',review='under_review',last=time){return JSON.parse(vm.runInContext(`JSON.stringify(displayStatus(${JSON.stringify({submitted_at:time,last_submitted_at:last,score_band:band,status:review})},${JSON.stringify({deadline_at:deadline})}))`,context));}
test('6:27 PM after a 5 PM deadline is late, even with an old on-time band',()=>{assert.deepEqual(status('2026-10-03T18:27:38+08:00'),['danger','Submitted late / under review']);});
test('the exact deadline is on time; one millisecond after is late',()=>{assert.match(status(deadline)[1],/on time/);assert.match(status('2026-10-03T17:00:00.001+08:00')[1],/late/);assert.match(status('2026-10-03T16:59:59.999+08:00')[1],/on time/);});
test('the timezone offset does not change the same absolute timestamp',()=>{assert.match(status('2026-10-03T10:27:38Z')[1],/late/);assert.match(status('2026-10-03T09:00:00Z')[1],/on time/);});
test('current time and a later resubmission do not reclassify an on-time first submission',()=>{assert.match(status('2026-10-03T16:00:00+08:00','grace_period','under_review','2026-10-04T12:00:00+08:00')[1],/on time/);});
test('approval does not hide lateness; rejected and returned states remain distinct',()=>{assert.deepEqual(status('2026-10-03T18:27:38+08:00','grace_period','approved'),['danger','Approved / submitted late']);assert.equal(status('2026-10-03T18:27:38+08:00','late','rejected')[1],'Rejected');assert.equal(status('2026-10-03T18:27:38+08:00','late','correction_requested')[1],'Returned / needs revision');});
test('a draft stays Pending',()=>{assert.deepEqual(status(null),['neutral','Pending']);});
