"""Optional end-to-end owner WebSocket test: python tests/owner-filter-integration.py
Requires the 'websockets' Python package. Runs an isolated server and leaves no credentials in the project.
"""
import asyncio, json, os, socket, hashlib, secrets, subprocess, time, urllib.request, urllib.error, tempfile
import websockets
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
PASSWORD = 'DISPOSABLE_TEST_SECRET_12345'

def fetch_json(url, body=None, cookie=None):
    h={'Content-Type':'application/json'}
    if cookie:h['Cookie']=cookie
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers=h)
    with urllib.request.urlopen(req,timeout=3) as r:return json.load(r),r.headers

async def next_type(ws,typ,timeout=2):
    while True:
        msg=json.loads(await asyncio.wait_for(ws.recv(),timeout))
        if msg['type']==typ:return msg

async def intro(ws,gender='undisclosed'):
    await ws.send(json.dumps({'type':'hello','adult':True,'session':secrets.token_hex(16)+'-0000','region':'north-america','target':'any','gender':gender}))
    await next_type(ws,'ready')

async def main():
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    origin=f'http://127.0.0.1:{port}'
    salt=secrets.token_bytes(16)
    passwd_hash=hashlib.scrypt(PASSWORD.encode(),salt=salt,n=2**14,r=8,p=1,dklen=64)
    with tempfile.TemporaryDirectory() as reports_dir:
        env={**os.environ,'PORT':str(port),'HOST':'127.0.0.1','PUBLIC_ORIGIN':origin,
             'PRIVATE_FILTER_PASSWORD_HASH':salt.hex()+'$'+passwd_hash.hex(),
             'REPORTS_FILE':str(Path(reports_dir)/'reports.jsonl')}
        server=subprocess.Popen(['node','server.js'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                try:
                    await asyncio.to_thread(fetch_json,origin+'/api/health')
                    break
                except Exception:await asyncio.sleep(.05)
            login, headers=await asyncio.to_thread(fetch_json,origin+'/api/private/login',{'password':PASSWORD})
            cookie=headers['Set-Cookie'].split(';',1)[0]
            uri=f'ws://127.0.0.1:{port}/ws'
            async with websockets.connect(uri,origin=origin,additional_headers={'Cookie':cookie}) as owner, \
                       websockets.connect(uri,origin=origin) as man, \
                       websockets.connect(uri,origin=origin) as woman:
                await asyncio.gather(intro(owner,'man'),intro(man,'man'),intro(woman,'woman'))
                await owner.send(json.dumps({'type':'find','genderTarget':'woman'}))
                await next_type(owner,'searching')
                await man.send(json.dumps({'type':'find'}))
                await next_type(man,'searching')
                await asyncio.sleep(.2)
                await woman.send(json.dumps({'type':'find'}))
                owner_match=await next_type(owner,'matched')
                woman_match=await next_type(woman,'matched')
                assert owner_match['matchId']==woman_match['matchId']
                print('PASS: password-authenticated owner matched self-reported woman, not waiting man.')
                await owner.send(json.dumps({'type':'report','reason':'spam','detail':'integration test'}))
                await next_type(owner,'report-received')
                await asyncio.sleep(.2)
                reports=(Path(reports_dir)/'reports.jsonl').read_text()
                assert 'integration test' in reports
                print('PASS: report captured to operator review file.')
        finally:
            server.terminate()
            try:server.wait(timeout=3)
            except subprocess.TimeoutExpired:server.kill()

if __name__=='__main__':asyncio.run(main())
