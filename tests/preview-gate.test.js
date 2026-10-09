'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {setTimeout:sleep}=require('node:timers/promises');
const path=require('node:path');
test('private pilot prevents anonymous access, requires an invite, and protects WebSockets', async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const origin=`http://127.0.0.1:${port}`;
  const proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,ROAM_PREVIEW_CODE:'unit-test-invite-only'},stdio:'ignore'});
  try{
    for(let i=0;i<70;i++){try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await sleep(60);}
    let r=await fetch(origin); assert.equal(r.status,200);
    assert.match(await r.text(), /PRIVATE PILOT/);
    assert.match(r.headers.get('x-robots-tag'),/noindex/);
    assert.equal((await fetch(`${origin}/api/stats`)).status,401);
    assert.match(await (await fetch(`${origin}/robots.txt`)).text(),/Disallow: \/$/m);
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve,reject)=>{ws.addEventListener('close',resolve,{once:true});ws.addEventListener('error',resolve,{once:true});setTimeout(()=>reject(Error('Expected WS reject')),1000).unref();});
    r=await fetch(`${origin}/api/preview/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'incorrect'})});
    assert.equal(r.status,401);
    r=await fetch(`${origin}/api/preview/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'unit-test-invite-only'})});
    assert.equal(r.status,200);
    const cookie=r.headers.get('set-cookie').split(';')[0];
    assert.match(cookie,/^roam_preview=/);
    assert.equal((await fetch(`${origin}/api/stats`,{headers:{Cookie:cookie}})).status,200);
    const index=await fetch(origin,{headers:{Cookie:cookie}});assert.match(await index.text(),/Random Video Chat With Strangers Worldwide/);
  } finally {proc.kill();}
});
