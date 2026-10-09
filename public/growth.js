// Human-in-the-loop sharing only. No unsolicited messages or automatic posting.
'use strict';
(() => {
  const base=window.location.origin+'/';
  const makeLink=source=>`${base}?utm_source=${encodeURIComponent(source)}&utm_medium=referral&utm_campaign=community_launch`;
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const temp=document.createElement('textarea');temp.value=text;temp.setAttribute('readonly','');temp.style.position='fixed';temp.style.opacity='0';document.body.append(temp);temp.select();
      try { return document.execCommand('copy'); } catch { return false; } finally { temp.remove(); }
    }
  }
  async function share(kind,button) {
    const url=makeLink(kind||'friend');
    try {
      if (navigator.share) await navigator.share({title:'Roam — free random video chat (18+)',text:'Join other adults on Roam for real random video conversations. No account required.',url});
      else if (!await copy(url)) throw new Error('Copy unavailable');
      const before=button.textContent;button.textContent=navigator.share?'Shared!':'Invite link copied!';setTimeout(()=>button.textContent=before,2800);
    } catch(error){ if(error.name!=='AbortError'){window.prompt('Copy this link to invite people:',url);} }
  }
  document.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',()=>share(b.dataset.share,b)));
  const copyEmbed=document.getElementById('copy-embed');const embed=document.getElementById('embed-code');
  if(embed){
    const url=makeLink('creator_widget');
    embed.textContent=`<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#4f46e5;color:white;padding:14px 20px;border-radius:10px;text-decoration:none;font:600 16px system-ui">Join Roam random video chat (18+) ↗</a>`;
    copyEmbed?.addEventListener('click',async()=>{const ok=await copy(embed.textContent);copyEmbed.textContent=ok?'Embed code copied!':'Copy code manually';});
  }
  document.querySelectorAll('[data-direct-copy]').forEach(b=>b.addEventListener('click',async()=>{
    const ok=await copy(makeLink(b.dataset.directCopy));b.textContent=ok?'Link copied!':'Copy link manually';
  }));
})();
