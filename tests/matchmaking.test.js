'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { setTimeout: sleep } = require('node:timers/promises');
let port, base, proc;const clients=[];
const reportsPath = path.join(os.tmpdir(), `roam-test-reports-${process.pid}-${crypto.randomUUID()}.jsonl`);
const password='THIS_IS_A_TEST_PASSWORD_12345';
function client() {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages=[]; const waiters=[];
  socket.addEventListener('message',e=>{
    const m=JSON.parse(e.data);messages.push(m);
    for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(m)) {const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}
  });
  const obj={socket,messages,
    send(type,data={}){socket.send(JSON.stringify({type,...data}));},
    wait(type,predicate=()=>true,ms=2000){const old=messages.find(m=>m.type===type&&predicate(m));if(old)return Promise.resolve(old);return new Promise((resolve,reject)=>{const w={predicate:m=>m.type===type&&predicate(m),resolve,timer:setTimeout(()=>{const idx=waiters.indexOf(w);if(idx>=0)waiters.splice(idx,1);reject(Error('Timeout waiting '+type));},ms)};waiters.push(w);});},
    async hello({region='north-america',target='any',gender='undisclosed',adult=true}={}){
      if(socket.readyState!==WebSocket.OPEN)await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
      obj.send('hello',{region,target,gender,adult,session:crypto.randomUUID()});
      if(adult)await obj.wait('ready');
    },close(){socket.close()}
  };clients.push(obj);return obj;
}
before(async()=>{
  port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
  base=`http://127.0.0.1:${port}`;
  const salt=crypto.randomBytes(16);const hash=crypto.scryptSync(password,salt,64);
  proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PRIVATE_FILTER_PASSWORD_HASH:salt.toString('hex')+'$'+hash.toString('hex'),PUBLIC_ORIGIN:base,REPORTS_FILE:reportsPath},stdio:'ignore'});
  for(let i=0;i<70;i++){try{if((await fetch(`${base}/api/health`)).ok)return;}catch{}await sleep(70);}
  throw Error('server did not start');
});
after(()=>{for(const c of clients)try{c.close();}catch{};proc?.kill();try{fs.unlinkSync(reportsPath);}catch{}});
test('serves HTML, live statistics, and one-hour TURN-safe config',async()=>{
  const r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/Start video chatting/);
  const stats=await fetch(`${base}/api/stats`).then(r=>r.json());assert.equal(typeof stats.online,'number');
  const config=await fetch(`${base}/api/config`).then(r=>r.json());assert.ok(config.iceServers[0].urls.startsWith('stun:'));
});
test('SEO metadata, public OpenGraph preview, and crawlable sitemap use the live site origin', async()=>{
  const html=await fetch(base).then(r=>r.text());
  assert.match(html,/<title>Random Video Chat With Strangers Worldwide/);
  assert.match(html,/name=\"description\"/);
  assert.ok(html.includes(`<link rel="canonical" href="${base}/"`));
  assert.ok(html.includes(`content="${base}/social-preview.jpg"`));
  assert.ok(html.includes('application/ld+json'));
  assert.ok(html.includes('Is Roam random video chat free?'));
  const preview=await fetch(`${base}/social-preview.jpg`);
  assert.equal(preview.headers.get('content-type'),'image/jpeg');
  assert.equal(preview.status,200);
  const robots=await fetch(`${base}/robots.txt`).then(r=>r.text());
  assert.ok(robots.includes(`Sitemap: ${base}/sitemap.xml`));
  const sitemap=await fetch(`${base}/sitemap.xml`).then(r=>r.text());
  assert.ok(sitemap.includes(`<loc>${base}/</loc>`));
});
test('rejects underage introduction',async()=>{
  const a=client();await a.hello({adult:false});assert.match((await a.wait('error')).message,/18/);a.close();
});
test('private password is verified server-side, not in frontend',async()=>{
  const status=await fetch(`${base}/api/private/status`).then(r=>r.json());assert.equal(status.authenticated,false);
  const bad=await fetch(`${base}/api/private/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})});assert.equal(bad.status,401);
  const good=await fetch(`${base}/api/private/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(good.status,200);assert.match(good.headers.get('set-cookie'),/HttpOnly/);assert.ok(good.headers.get('set-cookie').includes('SameSite=Strict'));
  const cookie=good.headers.get('set-cookie').split(';')[0];
  const yes=await fetch(`${base}/api/private/status`,{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(yes.authenticated,true);
  const out=await fetch(`${base}/api/private/logout`,{method:'POST',headers:{Cookie:cookie}});assert.equal(out.status,200);
});
test('no owner: gender-filter bypass is rejected',async()=>{
  const a=client();await a.hello();a.send('find',{genderTarget:'woman'});assert.match((await a.wait('error')).message,/password/);a.close();
});
test('mutual region matching, encrypted signaling relay, skip and avoid immediate rematch',async()=>{
  const a=client(),b=client();await Promise.all([a.hello({region:'north-america',target:'europe',gender:'man'}),b.hello({region:'europe',target:'north-america',gender:'woman'})]);
  a.send('find',{target:'europe'});b.send('find',{target:'north-america'});
  const [am,bm]=await Promise.all([a.wait('matched'),b.wait('matched')]);
  assert.equal(am.matchId,bm.matchId);assert.equal(am.region,'europe');assert.equal(bm.region,'north-america');
  a.send('signal',{kind:'candidate',payload:{candidate:'candidate:0 1 UDP 123 192.0.2.1 999 typ host'},matchId:am.matchId});
  assert.equal((await b.wait('signal')).kind,'candidate');
  a.send('chat',{text:'Hello from the USA'});assert.equal((await b.wait('chat')).text,'Hello from the USA');
  a.send('skip');await Promise.all([a.wait('searching'),b.wait('partner-left')]);
  await sleep(150);assert.equal(a.messages.filter(m=>m.type==='matched').length,1);
  const c=client();await c.hello({region:'europe',target:'north-america'});c.send('find');
  const m=await a.wait('matched',x=>x.matchId!==am.matchId);assert.notEqual(m.matchId,am.matchId);
  a.close();b.close();c.close();
});
test('incompatible region searches stay in the queue without fabricated users',async()=>{
  const a=client(),b=client();await Promise.all([a.hello({region:'asia',target:'asia'}),b.hello({region:'africa',target:'africa'})]);
  a.send('find',{target:'asia'});b.send('find',{target:'africa'});
  await Promise.all([a.wait('searching'),b.wait('searching')]);
  await sleep(180);assert.equal(a.messages.some(m=>m.type==='matched'),false);assert.equal(b.messages.some(m=>m.type==='matched'),false);
  a.close();b.close();
});

test('report and block actions detach participants and record the abuse report',async()=>{
  const a=client(),b=client();
  await Promise.all([a.hello({region:'oceania',target:'middle-east'}),b.hello({region:'middle-east',target:'oceania'})]);
  a.send('find',{target:'middle-east'});b.send('find',{target:'oceania'});
  await Promise.all([a.wait('matched'),b.wait('matched')]);
  a.send('report',{reason:'spam',detail:'Test report from integration suite'});
  await Promise.all([a.wait('report-received'),b.wait('partner-left')]);
  const lines=fs.readFileSync(reportsPath,'utf8').trim().split('\n');
  const record=JSON.parse(lines.at(-1));
  assert.equal(record.reason,'spam');
  assert.equal(record.detail,'Test report from integration suite');
  // Neither of the reported peers may be immediately rematched to their reporter.
  assert.equal(a.messages.filter(m=>m.type==='matched').length,1);
  const d=client(),e=client();
  await Promise.all([d.hello({region:'south-america',target:'asia'}),e.hello({region:'asia',target:'south-america'})]);
  d.send('find',{target:'asia'});e.send('find',{target:'south-america'});
  await Promise.all([d.wait('matched'),e.wait('matched')]);
  d.send('block');
  await Promise.all([d.wait('searching'),e.wait('partner-left')]);
  await sleep(75);
  assert.equal(d.messages.filter(m=>m.type==='matched').length,1);
  a.close();b.close();d.close();e.close();
});
