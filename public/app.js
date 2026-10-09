'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries([
    'landing','experience','start-button','landing-error','adult-confirm','your-region','target-region','your-gender','gender-target','private-filter','online-count',
    'owner-trigger','owner-dialog','owner-description','owner-form','owner-password','owner-login','owner-logout','owner-error','password-label',
    'remote-video','local-video','self-avatar','waiting-overlay','waiting-title','waiting-subtitle','waiting-eyebrow','waiting-queue','invite-button','remote-label','remote-region','duration','session-status','session-region-label',
    'mic-button','camera-button','skip-button','end-button','exit-top','home-link','report-button','block-button','report-dialog','report-reason','report-detail','send-report',
    'chat-messages','chat-form','chat-input','send-button','toast'
  ].map(id => [id, $(id)]));
  const labels = {any:'Anywhere', 'north-america':'North America','south-america':'South America',europe:'Europe',asia:'Asia',africa:'Africa',oceania:'Oceania','middle-east':'Middle East'};
  const state = { active:false, ready:false, ws:null, stream:null, pc:null, matchId:null, pendingIce:[], remoteStream:null,
    muted:false, cameraOff:false, connectedAt:0, elapsedTimer:null, reconnectTimer:null, reconnectAttempts:0,
    owner:false, iceServers:[{urls:'stun:stun.l.google.com:19302'}], matchRegion:'', connectionTimeout:null, sessionId:null, toastTimeout:null };

  function showError(target, message) { target.textContent = message; target.hidden = !message; }
  function notify(message) { ui.toast.textContent = message; ui.toast.hidden = false; clearTimeout(state.toastTimeout); state.toastTimeout = setTimeout(() => ui.toast.hidden = true, 4800); }
  function saveOptions() {
    try { localStorage.setItem('roam_settings', JSON.stringify({ region: ui['your-region'].value, target:ui['target-region'].value, gender:ui['your-gender'].value })); } catch {}
  }
  function restoreOptions() {
    try {
      const settings = JSON.parse(localStorage.getItem('roam_settings') || '{}');
      for (const [field,val] of [['your-region',settings.region],['target-region',settings.target],['your-gender',settings.gender]]) {
        if ([...ui[field].options].some(o=>o.value===val)) ui[field].value=val;
      }
    } catch {}
  }
  async function checkOwner() {
    try {
      const result = await fetch('/api/private/status', { credentials:'same-origin',cache:'no-store' }).then(r=>r.json());
      state.owner = !!result.authenticated;
      ui['private-filter'].hidden = !state.owner;
      if (!state.owner) ui['gender-target'].value = 'any';
      ui['owner-description'].textContent = state.owner ? 'Owner access is unlocked on this browser. You can use the private gender filter on the main page.' :
        result.enabled ? 'Enter your private password to unlock the owner-only gender filter. Your password is verified securely by the server.' :
        'Owner mode has not been configured. Follow README.md to create and privately set your owner password on the server.';
      ui['password-label'].hidden = state.owner || !result.enabled;
      ui['owner-login'].hidden = state.owner || !result.enabled;
      ui['owner-logout'].hidden = !state.owner;
      ui['owner-trigger'].title = state.owner ? 'Owner mode unlocked' : 'Private owner access';
    } catch { ui['owner-description'].textContent = 'Unable to connect to the server.'; }
  }
  ui['owner-trigger'].addEventListener('click', async () => { showError(ui['owner-error'],'');ui['owner-password'].value=''; await checkOwner();ui['owner-dialog'].showModal(); });
  ui['owner-login'].addEventListener('click', async () => {
    const password = ui['owner-password'].value;
    if (!password) return showError(ui['owner-error'],'Enter your password.');
    ui['owner-login'].disabled = true;
    try {
      const r = await fetch('/api/private/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || 'Authentication failed.');
      ui['owner-password'].value='';
      await checkOwner();ui['owner-dialog'].close();notify('Owner filters unlocked.');
    } catch (e) { showError(ui['owner-error'],e.message); }
    finally { ui['owner-login'].disabled = false; }
  });
  ui['owner-password'].addEventListener('keydown',e=> { if(e.key==='Enter'){e.preventDefault();ui['owner-login'].click();} });
  ui['owner-logout'].addEventListener('click', async () => {
    try { await fetch('/api/private/logout',{method:'POST',credentials:'same-origin'}); } catch {}
    await checkOwner();ui['owner-dialog'].close();notify('Owner filters locked.');
  });

  function send(type,data={}) {
    if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type,...data}));
  }
  function hello() {
    send('hello',{adult:true,session:state.sessionId,region:ui['your-region'].value,target:ui['target-region'].value,gender:ui['your-gender'].value});
  }
  function find() {
    if (!state.ready || !state.active) return;
    send('find',{region:ui['your-region'].value,target:ui['target-region'].value,gender:ui['your-gender'].value,
      genderTarget: state.owner ? ui['gender-target'].value : 'any'});
  }
  function setWaiting(title='Finding your person',description='Exploring the world for someone to meet.',badge='Searching the world') {
    ui['waiting-overlay'].hidden=false; ui['waiting-title'].textContent=title;
    ui['waiting-subtitle'].textContent=description; ui['waiting-queue'].textContent='Looking for an available match';
    ui['session-status'].textContent=badge;
    ui['remote-video'].style.display='none';ui['remote-label'].hidden=true;
    ui['send-button'].disabled=true;ui['chat-input'].disabled=true;
    ui['report-button'].disabled=true;ui['block-button'].disabled=true;
  }
  function clearChat() {
    ui['chat-messages'].replaceChildren();
    const note=document.createElement('div');note.className='chat-note';
    note.textContent='Messages are only shared with your current match and are not stored by this app.';
    ui['chat-messages'].append(note);
  }
  function addChat(text, mine=false) {
    const el=document.createElement('div');el.className='chat-bubble'+(mine?' mine':'');
    const label=document.createElement('small');label.textContent=mine?'YOU':'STRANGER';
    const content=document.createElement('span');content.textContent=text;
    el.append(label,content);ui['chat-messages'].append(el);
    ui['chat-messages'].scrollTop=ui['chat-messages'].scrollHeight;
  }
  function clearCall() {
    clearTimeout(state.connectionTimeout);
    state.connectionTimeout=null;
    clearInterval(state.elapsedTimer);state.elapsedTimer=null;
    state.matchId=null;state.connectedAt=0;state.pendingIce=[];state.matchRegion='';
    if (state.pc) { const pc=state.pc;state.pc=null;pc.ontrack=null;pc.onicecandidate=null;pc.onconnectionstatechange=null;pc.close(); }
    if (state.remoteStream) { state.remoteStream.getTracks().forEach(t=>{try { t.stop(); }catch {}});state.remoteStream=null; }
    ui['remote-video'].srcObject=null;ui['duration'].textContent='00:00';
    clearChat();
  }
  function setLive() {
    if (!state.matchId || !state.pc) return;
    ui['waiting-overlay'].hidden=true;ui['remote-video'].style.display='block';ui['remote-label'].hidden=false;
    ui['session-status'].textContent='Connected · Live';
    state.connectedAt=Date.now();clearInterval(state.elapsedTimer);
    state.elapsedTimer=setInterval(()=> { const s=Math.floor((Date.now()-state.connectedAt)/1000);ui['duration'].textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); },1000);
    ui['send-button'].disabled=false;ui['chat-input'].disabled=false;
    ui['report-button'].disabled=false;ui['block-button'].disabled=false;
    ui['remote-region'].textContent='Someone in '+(labels[state.matchRegion]||'the world');
  }
  async function beginPeer(matchId, initiator, region) {
    clearCall();state.matchId=matchId;state.matchRegion=region;
    ui['remote-region'].textContent=labels[region] || 'New connection';
    setWaiting('Making the connection','Setting up an encrypted peer-to-peer call…','Connecting to a new person');
    const pc=new RTCPeerConnection({iceServers:state.iceServers});state.pc=pc;
    // A match is not a usable call until ICE establishes a connection.
    // Do not let unreachable peers trap users indefinitely on 'Connecting'.
    state.connectionTimeout=setTimeout(()=>{
      if(state.pc===pc && state.matchId===matchId && pc.connectionState!=='connected'){
        notify('Could not establish the call. Searching for someone else…');skip();
      }
    },20000);
    const pending=[];state.pendingIce=pending;
    state.remoteStream=new MediaStream();
    ui['remote-video'].srcObject=state.remoteStream;
    for (const track of state.stream.getTracks()) pc.addTrack(track,state.stream);
    pc.ontrack=e => {
      if (state.pc!==pc) return;
      for(const track of e.streams[0]?.getTracks() || [e.track]) {
        if(!state.remoteStream.getTracks().some(t=>t.id===track.id)) state.remoteStream.addTrack(track);
      }
      // Video might be disabled, but a connected audio-only participant should still count as a match.
      ui['remote-video'].play().catch(()=>{});
    };
    pc.onicecandidate=e => { if (e.candidate && state.matchId===matchId) send('signal',{matchId,kind:'candidate',payload:e.candidate.toJSON()}); };
    pc.onconnectionstatechange=() => {
      if(state.pc!==pc || state.matchId!==matchId) return;
      if(pc.connectionState==='connected') {clearTimeout(state.connectionTimeout);state.connectionTimeout=null;setLive();}
      else if (pc.connectionState==='failed') {notify('Call connection failed. Finding another person…');skip();}
      else if(pc.connectionState==='disconnected') {
        ui['session-status'].textContent='Reconnecting…';
        clearTimeout(state.connectionTimeout);
        state.connectionTimeout=setTimeout(()=>{if(state.pc===pc && pc.connectionState!=='connected') skip();},9000);
      }
    };
    try {
      if(initiator){const offer=await pc.createOffer();if(state.pc!==pc)return;await pc.setLocalDescription(offer);if(state.pc!==pc)return;send('signal',{matchId,kind:'offer',payload:pc.localDescription.toJSON()});}
    } catch(e){ if(state.pc===pc){notify('Unable to connect. Finding another match…');skip();}}
  }
  async function handleSignal(msg) {
    const pc=state.pc;if(!pc||state.matchId!==msg.matchId) return;
    try {
      if (msg.kind==='offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        if (state.pc!==pc) return;
        for (const c of state.pendingIce.splice(0)) await pc.addIceCandidate(c);
        const answer=await pc.createAnswer();if(state.pc!==pc)return;
        await pc.setLocalDescription(answer);
        if(state.pc===pc)send('signal',{matchId:msg.matchId,kind:'answer',payload:pc.localDescription.toJSON()});
      } else if(msg.kind==='answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        if(state.pc!==pc)return;
        for(const c of state.pendingIce.splice(0)) await pc.addIceCandidate(c);
      } else if(msg.kind==='candidate') {
        const candidate=new RTCIceCandidate(msg.payload);
        if(pc.remoteDescription)await pc.addIceCandidate(candidate);
        else state.pendingIce.push(candidate);
      }
    }catch(e){if(state.pc===pc){console.warn('Signaling failed:',e.name);notify('Unable to establish the call. Trying another match…');skip();}}
  }
  function onMessage(msg) {
    switch(msg.type) {
      case 'welcome': case 'stats':ui['online-count'].textContent=msg.online??'0';break;
      case 'ready':state.ready=true;state.sessionId=msg.session;find();break;
      case 'searching':setWaiting();break;
      case 'matched':beginPeer(msg.matchId,msg.initiator,msg.region);break;
      case 'signal':handleSignal(msg);break;
      case 'partner-left':clearCall();setWaiting('Finding someone new','That conversation ended. Looking for your next match…');break;
      case 'chat': if(msg.matchId===state.matchId && typeof msg.text==='string')addChat(msg.text);break;
      case 'report-received':notify('Report received. Thank you for helping keep Roam safe.');break;
      case 'error':notify(msg.message||'Something went wrong.');break;
    }
  }
  function connectSocket() {
    if(!state.active)return;
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(`${protocol}//${location.host}/ws`);state.ws=socket;state.ready=false;
    socket.addEventListener('open',()=>{if(!state.active||state.ws!==socket){socket.close();return;}state.reconnectAttempts=0;hello();});
    socket.addEventListener('message',e=>{if(state.ws!==socket)return;try{onMessage(JSON.parse(e.data));}catch(err){console.warn('Invalid server message',err);}});
    socket.addEventListener('close',()=>{
      if(state.ws!==socket)return;
      state.ready=false;state.ws=null;clearCall();
      if(!state.active)return;
      const wait=Math.min(15000,1000*2**Math.min(state.reconnectAttempts++,4));
      setWaiting('Reconnecting to Roam','Connection interrupted. Trying to restore the matchmaking queue…','Reconnecting');
      clearTimeout(state.reconnectTimer);state.reconnectTimer=setTimeout(connectSocket,wait);
    });
    socket.addEventListener('error',()=>{if(state.ws===socket)socket.close();});
  }
  async function start() {
    if(state.active)return;
    if(!ui['adult-confirm'].checked)return showError(ui['landing-error'],'Please confirm you are at least 18 years old before you begin.');
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)return showError(ui['landing-error'],'Camera access requires HTTPS or http://localhost. Open the app from a secure address.');
    showError(ui['landing-error'],'');ui['start-button'].disabled=true;ui['start-button'].textContent='Requesting camera & microphone…';saveOptions();
    try {
      try {state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
      catch(error){
        if(error.name==='NotFoundError' || error.name==='OverconstrainedError'){
          // Webcam/microphone not installed: offer an audio-only fallback while retaining text chat.
          state.stream=await navigator.mediaDevices.getUserMedia({audio:true});
          showError(ui['landing-error'],'Camera unavailable; started in audio-only mode.');
        }else throw error;
      }
      try {const config=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());if(Array.isArray(config.iceServers)&&config.iceServers.length)state.iceServers=config.iceServers;}catch{}
      if(!state.sessionId){try{state.sessionId=sessionStorage.getItem('roam_session')||crypto.randomUUID();sessionStorage.setItem('roam_session',state.sessionId);}catch{state.sessionId=crypto.randomUUID();}}
      state.active=true;state.muted=false;state.cameraOff=!state.stream.getVideoTracks().length;
      ui['local-video'].srcObject=state.stream;ui['self-avatar'].hidden=!state.cameraOff;
      ui['camera-button'].classList.toggle('off',state.cameraOff);
      ui['camera-button'].setAttribute('aria-label',state.cameraOff?'Camera unavailable':'Turn off camera');
      ui['mic-button'].classList.remove('off');
      ui.landing.hidden=true;ui.experience.hidden=false;document.querySelector('.site-footer').hidden=true;
      ui['session-region-label'].textContent=labels[ui['target-region'].value]||'Anywhere';
      clearChat();setWaiting();connectSocket();
    }catch(e){
      const message=e.name==='NotAllowedError'?'Camera or microphone permission was denied. Use the address-bar permissions control to allow access, then try again.':
        e.name==='NotFoundError'?'No microphone or camera was detected. Connect a device and try again.':
        'Could not start your camera or microphone: '+e.message;
      showError(ui['landing-error'],message);stopMedia();
    }finally{ui['start-button'].disabled=false;ui['start-button'].innerHTML='Start video chatting <span class="arrow">→</span>';}
  }
  function stopMedia(){if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}ui['local-video'].srcObject=null;}
  function end(){
    state.active=false;state.ready=false;clearTimeout(state.reconnectTimer);state.reconnectTimer=null;
    send('leave');if(state.ws){const ws=state.ws;state.ws=null;ws.close(1000,'left');}
    clearCall();stopMedia();ui.landing.hidden=false;ui.experience.hidden=true;
    document.querySelector('.site-footer').hidden=false;window.scrollTo({top:0,behavior:'instant'});
  }
  function skip(){if(!state.active)return;clearCall();setWaiting('Finding someone new','Looking for a fresh connection…');send('skip');}
  ui['invite-button'].addEventListener('click',async()=>{
    const url=location.origin+'/';
    try{
      if(navigator.share){await navigator.share({title:'Meet me on Roam',text:'Join a live video chat on Roam',url});notify('Invitation shared.');}
      else{await navigator.clipboard.writeText(url);notify('Invitation link copied.');}
    }catch(e){if(e.name!=='AbortError')notify('Could not share the link.');}
  });
  ui['start-button'].addEventListener('click',start);
  ui['skip-button'].addEventListener('click',skip);
  for(const id of ['end-button','exit-top'])ui[id].addEventListener('click',end);
  ui['home-link'].addEventListener('click',e=>{e.preventDefault();end();});
  ui['mic-button'].addEventListener('click',()=>{
    if(!state.stream?.getAudioTracks().length){notify('No microphone available.');return;}
    state.muted=!state.muted;for(const t of state.stream.getAudioTracks())t.enabled=!state.muted;
    ui['mic-button'].classList.toggle('off',state.muted);
    ui['mic-button'].title=state.muted?'Unmute microphone':'Mute microphone';
    ui['mic-button'].setAttribute('aria-label',ui['mic-button'].title);
    notify(state.muted?'Microphone muted.':'Microphone on.');
  });
  ui['camera-button'].addEventListener('click',()=>{
    if(!state.stream?.getVideoTracks().length){notify('No camera available on this device.');return;}
    state.cameraOff=!state.cameraOff;for(const t of state.stream.getVideoTracks())t.enabled=!state.cameraOff;
    ui['camera-button'].classList.toggle('off',state.cameraOff);
    ui['self-avatar'].hidden=!state.cameraOff;
    ui['camera-button'].title=state.cameraOff?'Turn on camera':'Turn off camera';
    ui['camera-button'].setAttribute('aria-label',ui['camera-button'].title);
  });
  ui['chat-form'].addEventListener('submit',e=>{
    e.preventDefault();const text=ui['chat-input'].value.trim().slice(0,500);
    if(!state.matchId||!text)return;send('chat',{text});addChat(text,true);ui['chat-input'].value='';
  });
  ui['report-button'].addEventListener('click',()=>{if(!state.matchId)return notify('No partner to report.');ui['report-dialog'].showModal();});
  ui['send-report'].addEventListener('click',()=>{
    if(!state.matchId){ui['report-dialog'].close();return;}
    send('report',{reason:ui['report-reason'].value,detail:ui['report-detail'].value});
    ui['report-dialog'].close();ui['report-detail'].value='';clearCall();setWaiting('Finding someone new','The reported user has been blocked for this session.');
  });
  ui['block-button'].addEventListener('click',()=>{
    if(!state.matchId)return notify('No partner to block.');send('block');clearCall();setWaiting('Finding someone new','You will not be paired with that session again.');
  });
  for(const id of ['your-region','target-region','your-gender']) ui[id].addEventListener('change',saveOptions);
  async function updateStats(){if(state.active)return;try{const r=await fetch('/api/stats',{cache:'no-store'}).then(x=>x.json());if(Number.isFinite(r.online))ui['online-count'].textContent=r.online;}catch{}}
  restoreOptions();checkOwner();clearChat();updateStats();setInterval(updateStats,15000);
  window.addEventListener('pagehide',()=>{if(state.active){send('leave');stopMedia();}});
})();
