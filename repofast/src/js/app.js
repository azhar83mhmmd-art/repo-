'use strict';
// RepoFast — runs fully in the browser. The PAT is stored only on this device (localStorage) and is sent only to api.github.com.
const $=(s,e=document)=>e.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const I={layout:'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
upload:'<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
history:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
commit:'<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
plus:'<path d="M5 12h14M12 5v14"/>',chev:'<path d="m6 9 6 6 6-6"/>',check:'<path d="M20 6 9 17l-5-5"/>',trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
pencil:'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
ext:'<path d="M7 7h10v10M7 17 17 7"/>',ok:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
warn:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
shield:'<path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'};
const ic=(n,s=19)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const S={token:localStorage.getItem('rf_token')||'',user:null,route:'overview',repos:[],more:false,page:1,repo:'',branch:'',path:'',q:'',vis:'all',files:[],zipName:''};
const cfg=()=>({msg:'Upload project via RepoFast',mode:'preserve',conflict:'replace',max:100,...LS.get('rf_set',{})});
const ERR={401:'Your GitHub token is invalid or expired.',403:'Your token does not have sufficient permissions.',404:'Repository, branch or file not found.',409:'Repository has changed (or is empty). Please refresh and try again.',413:'Upload exceeds the request size limit.',422:'GitHub rejected the requested operation.',429:'GitHub API rate limit reached. Please try again later.'};
const NAV=[['overview','Overview','layout','Workspace'],['repos','Repositories','folder','Workspace'],['upload','Upload ZIP','upload','Workspace'],['explorer','File Explorer','file','Workspace'],['history','Upload History','history','Activity'],['commits','Recent Commits','commit','Activity'],['settings','GitHub & Settings','key','Preferences']];
function toast(m,t=''){const e=document.createElement('div');e.className='toast '+t;e.innerHTML=ic(t==='err'?'warn':t==='wn'?'warn':'ok',18)+'<span>'+esc(m)+'</span>';$('#toasts').append(e);setTimeout(()=>e.remove(),5000)}
async function gh(p,o={},t=0){
 const r=await fetch('https://api.github.com'+p,{method:o.method||'GET',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+S.token,...(o.body?{'Content-Type':'application/json'}:{})},body:o.body?JSON.stringify(o.body):undefined});
 if([502,503].includes(r.status)&&t<2){await new Promise(x=>setTimeout(x,800*(t+1)));return gh(p,o,t+1)}
 S.scopes=r.headers.get('x-oauth-scopes');
 if(!r.ok){let d='';try{d=(await r.json()).message}catch{}const rl=r.status===403&&r.headers.get('x-ratelimit-remaining')==='0';throw Error((rl?ERR[429]:ERR[r.status]||'An unexpected error occurred.')+(d?' ['+d+']':''))}
 return r.status===204?null:r.json()}
const ep=p=>p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const sz=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const dt=d=>d?new Date(d).toLocaleString():'-';
const b64=u8=>{let s='';for(let i=0;i<u8.length;i+=32768)s+=String.fromCharCode.apply(null,u8.subarray(i,i+32768));return btoa(s)};
const unb64=c=>new TextDecoder().decode(Uint8Array.from(atob(c.replace(/\n/g,'')),x=>x.charCodeAt(0)));
async function pool(a,n,fn){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<a.length){const k=i++;await fn(a[k],k)}}))}
const hist=()=>LS.get('rf_hist',[]);
function modal(h){$('#modal').innerHTML=h?`<div class="card">${h}</div>`:''}
async function loadRepos(more){if(S.repos.length&&!more)return;S.page=more?S.page+1:1;const a=await gh(`/user/repos?per_page=100&sort=updated&affiliation=owner&page=${S.page}`);S.repos=more?S.repos.concat(a):a;S.more=a.length===100;if(!S.repo&&S.repos[0])setRepo(S.repos[0].full_name)}
function setRepo(n){S.repo=n;S.branch=(S.repos.find(r=>r.full_name===n)||{}).default_branch||'main';S.path=''}
const repoSel=()=>`<select id="repoSel">${S.repos.map(r=>`<option ${r.full_name===S.repo?'selected':''}>${esc(r.full_name)}</option>`).join('')}</select>`;
const noRepo=()=>`<div class="card empty">No repository available. Create one first.</div>`;
async function branchSel(){const b=await gh(`/repos/${S.repo}/branches?per_page=100`);return `<select id="branchSel">${b.map(x=>`<option ${x.name===S.branch?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`}
const repoItem=r=>`<div class="item"><span class="tile sm">${ic("folder",18)}</span><div class="g"><div class="t">${esc(r.name)} <span class="badge">${r.private?'Private':'Public'}</span></div><div class="mu mono" style="font-size:12px">${esc(r.default_branch)} · updated ${dt(r.pushed_at||r.updated_at)}</div><div class="mu">${esc(r.description||'')}</div></div><a class="btn s" target="_blank" rel="noopener" href="${esc(r.html_url)}">${ic('ext',16)} GitHub</a><button class="btn s" data-act="manage" data-r="${esc(r.full_name)}">Manage</button></div>`;
const V={
async overview(){await loadRepos();const h=hist(),ok=h.filter(x=>x.ok);
 return `<h2>Welcome back to RepoFast</h2><p class="mu">Manage your GitHub repositories and upload projects effortlessly.</p>
 <div class="row"><button class="btn p" data-act="newrepo">${ic('plus')} Create Repository</button><button class="btn" data-go="upload">${ic('upload')} Upload ZIP</button><button class="btn" data-go="repos">${ic('folder')} Browse Repositories</button></div>
 <div class="grid">${[['folder','Total Repositories',S.repos.length+(S.more?'+':''),S.repos.filter(r=>r.private).length+' private'],['upload','Total Uploads',ok.length,h.length-ok.length+' failed'],['file','Files Uploaded',ok.reduce((a,x)=>a+x.count,0),'on this device'],['history','Recent Activity',ok[0]?new Date(ok[0].date).toLocaleDateString():'None',ok[0]?ok[0].repo:'No uploads yet']].map(c=>`<div class="card stat"><span class="tile">${ic(c[0])}</span><b>${esc(c[2])}</b><span>${c[1]}</span><div class="mu" style="font-size:12px">${esc(c[3])}</div></div>`).join('')}</div>
 <div class="card"><h3>Recent Repositories</h3>${S.repos.slice(0,5).map(repoItem).join('')||'<div class="empty">No repositories yet.</div>'}</div>
 <div class="card"><h3>Recent Upload Activity</h3>${histRows(h.slice(0,5))}</div>`},
async repos(){await loadRepos();return `<div class="row"><input id="q" placeholder="Search repository…" value="${esc(S.q)}" style="flex:1;min-width:180px"><select id="vis" data-seg style="width:auto"><option value="all">All</option><option ${S.vis==='public'?'selected':''} value="public">Public</option><option ${S.vis==='private'?'selected':''} value="private">Private</option></select><button class="btn" data-act="reload">${ic('refresh',17)} Refresh</button><button class="btn p" data-act="newrepo">${ic('plus',17)} New</button></div><div class="card" id="rl">${repoList()}</div>${S.more?'<button class="btn" data-act="more">Load more</button>':''}`},
async upload(){await loadRepos();if(!S.repo)return noRepo();const c=cfg();
 return `<h2>Upload your project</h2><p class="mu">Upload an entire project to GitHub in seconds. No need to upload files individually.</p>
 <div class="card"><div class="two"><div><label>Repository</label>${repoSel()}</div><div><label>Branch</label>${await branchSel()}</div></div></div>
 <div id="uz"><div class="drop" id="drop">${ic('upload',44)}<h3>Drag and drop your ZIP file here</h3><div class="mu">Or browse files · .zip · max ${c.max} MB · max 3000 files</div><input type="file" id="zf" accept=".zip" hidden></div></div>`},
async explorer(){await loadRepos();if(!S.repo)return noRepo();
 const items=await gh(`/repos/${S.repo}/contents/${ep(S.path)}?ref=${encodeURIComponent(S.branch)}`);items.sort((a,b)=>(a.type==='dir'?0:1)-(b.type==='dir'?0:1)||a.name.localeCompare(b.name));
 const segs=S.path.split('/').filter(Boolean);
 return `<div class="row"><div style="min-width:200px">${repoSel()}</div><div style="min-width:140px">${await branchSel()}</div><button class="btn" data-act="newfile">${ic('plus',17)} New file</button><button class="btn" data-act="addfile">${ic('upload',17)} Upload file</button><button class="btn" data-act="reload">${ic('refresh',17)}</button><input type="file" id="af" hidden></div>
 <div class="mono mu" style="margin-bottom:8px"><a href="#" data-act="cd" data-p="">${esc(S.repo)}</a>${segs.map((s,i)=>' / <a href="#" data-act="cd" data-p="'+esc(segs.slice(0,i+1).join('/'))+'">'+esc(s)+'</a>').join('')}</div>
 <div class="card">${items.map(f=>`<div class="item">${ic(f.type==='dir'?'folder':'file')}<div class="g"><div class="t">${f.type==='dir'?`<a href="#" data-act="cd" data-p="${esc(f.path)}">${esc(f.name)}</a>`:esc(f.name)}</div><div class="mu mono" style="font-size:12px">${f.type==='dir'?'folder':sz(f.size)}</div></div>${f.type==='file'?`<button class="btn s" data-act="edit" data-p="${esc(f.path)}">View / Edit</button><a class="btn s" href="${esc(f.download_url||'#')}" target="_blank" rel="noopener">Download</a><button class="btn s" title="Rename" data-act="ren" data-p="${esc(f.path)}">${ic('pencil',15)}</button><button class="btn s d" title="Delete" data-act="del" data-p="${esc(f.path)}" data-s="${f.sha}">${ic('trash',15)}</button>`:''}</div>`).join('')||'<div class="empty">Empty folder.</div>'}</div>`},
history(){return `<div class="row"><select id="hf" style="width:auto"><option>All</option><option>Successful</option><option>Failed</option></select><button class="btn d" data-act="clearh">${ic('trash',17)} Clear History</button></div><div class="card" id="hl">${histRows(hist())}</div>`},
async commits(){await loadRepos();if(!S.repo)return noRepo();const c=await gh(`/repos/${S.repo}/commits?sha=${encodeURIComponent(S.branch)}&per_page=25`);
 return `<div class="row"><div style="min-width:200px">${repoSel()}</div><div style="min-width:140px">${await branchSel()}</div></div><div class="card">${c.map(x=>`<div class="item">${ic('commit')}<div class="g"><div class="t">${esc(x.commit.message.split('\n')[0])}</div><div class="mu mono" style="font-size:12px">${x.sha.slice(0,7)} · ${esc(x.commit.author.name)} · ${dt(x.commit.author.date)} · ${esc(S.branch)}</div></div><a class="btn s" target="_blank" rel="noopener" href="${esc(x.html_url)}">${ic('ext',15)} View</a></div>`).join('')||'<div class="empty">No commits.</div>'}</div>`},
settings(){const c=cfg(),u=S.user;
 return `${u?'':'<div class="hero"><img src="public/logo.svg" width="52" height="52" alt=""><h2>RepoFast</h2><p class="mu">Upload Once. Organize Everything. Push to GitHub.</p></div>'}<div class="card"><h3>Connect your GitHub Account</h3>${u?`<div class="item"><img class="av" src="${esc(u.avatar_url)}" alt=""><div class="g"><div class="t">${esc(u.login)}</div><div class="mu">${esc(u.type)} · <span class="badge ok">Connected</span> · ${S.scopes?'scopes: '+esc(S.scopes):'fine-grained or no scopes'}</div></div></div>`:`<p class="mu">Connect your GitHub account to create repositories, upload files, and manage your projects directly from RepoFast.</p>`}
 <label>GitHub Personal Access Token</label><div class="row" style="margin:0"><input id="tok" type="password" autocomplete="off" placeholder="ghp_… / github_pat_…" style="flex:1"><button class="btn" data-act="showtok">Show</button></div>
 <div class="row"><button class="btn p" data-act="connect">${ic('key',17)} Connect GitHub</button>${u?`<button class="btn" data-act="connect" data-t="1">Test Connection</button><button class="btn d" data-act="disc">Disconnect</button>`:''}</div>
 <p class="mu" style="font-size:12px">${ic('shield',15)} Your token is stored only on this device and sent only to api.github.com. No server or database ever receives it. Classic PAT: scope <code>repo</code>. Fine-grained PAT: Contents + Administration (read/write) on target repos. <a target="_blank" rel="noopener" href="https://github.com/settings/tokens">GitHub token settings</a></p></div>
 <div class="card pref"><h3>Upload Preferences</h3><label>Default commit message</label><input id="s_msg" value="${esc(c.msg)}"><div class="two"><div><label>Default ZIP structure</label><select id="s_mode" data-seg><option value="preserve" ${c.mode==='preserve'?'selected':''}>Preserve</option><option value="root" ${c.mode==='root'?'selected':''}>Remove root folder</option></select></div><div><label>Conflict handling</label><select id="s_conf" data-seg><option value="replace" ${c.conflict==='replace'?'selected':''}>Replace</option><option value="skip" ${c.conflict==='skip'?'selected':''}>Skip</option></select></div></div><label>Maximum ZIP size (MB)</label><input id="s_max" type="number" min="1" max="500" value="${c.max}"><div class="row"><button class="btn p" data-act="saveset">Save Preferences</button></div></div>`}};
function repoList(){const q=S.q.toLowerCase();const l=S.repos.filter(r=>(S.vis==='all'||(S.vis==='private')===r.private)&&r.name.toLowerCase().includes(q));return l.map(repoItem).join('')||'<div class="empty">No repositories found.</div>'}
function histRows(h){return h.map(x=>`<div class="item"><div class="g"><div class="t">${esc(x.zip)} <span class="badge ${x.ok?'ok':'er'}">${x.ok?'Success':'Failed'}</span></div><div class="mu mono" style="font-size:12px">${esc(x.repo)}@${esc(x.branch)} · ${x.count} files · ${dt(x.date)}${x.sha?' · '+x.sha.slice(0,7):''}</div>${x.err?`<div class="mu">${esc(x.err)}</div>`:''}</div>${x.url?`<a class="btn s" target="_blank" rel="noopener" href="${esc(x.url)}">View Commit</a>`:''}</div>`).join('')||'<div class="empty">No activity yet.</div>'}
// ---------- ZIP ----------
const safe=n=>n&&!n.startsWith('/')&&!n.includes('\\')&&!n.split('/').some(s=>s==='..'||s==='.')&&!/^__MACOSX\//.test(n)&&!/(^|\/)\.DS_Store$/.test(n);
async function loadZip(f){const c=cfg();
 if(!/\.zip$/i.test(f.name))return toast('Invalid ZIP file.','err');
 if(f.size>c.max*1048576)return toast(`ZIP exceeds ${c.max} MB limit.`,'err');
 try{const z=await JSZip.loadAsync(f);const all=Object.values(z.files).filter(x=>!x.dir);
  const fl=all.filter(x=>safe(x.name));if(!fl.length)return toast('ZIP has no valid files.','err');
  if(fl.length>3000)return toast('Too many files (max 3000).','err');
  const tot=fl.reduce((a,x)=>a+(x._data?.uncompressedSize||0),0);if(tot>300*1048576)return toast('Extracted size too large (max 300 MB).','err');
  S.files=fl.map(x=>({name:x.name,e:x,size:x._data?.uncompressedSize||0,sel:true}));S.zipName=f.name;S.zipSize=f.size;
  if(all.length>fl.length)toast(`${all.length-fl.length} unsafe/system files ignored.`,'wn');toast('ZIP extracted successfully.');zipUI()
 }catch{toast('Invalid ZIP file.','err')}}
function plan(){const m=$('#mode').value,d=$('#dest').value.trim().replace(/^\/+|\/+$/g,'');const sel=S.files.filter(f=>f.sel);
 const strip=m==='root'&&S.files.every(f=>f.name.includes('/'))&&new Set(S.files.map(f=>f.name.split('/')[0])).size===1;
 return sel.map(f=>({f,path:[d,strip?f.name.split('/').slice(1).join('/'):f.name].filter(Boolean).join('/')}))}
function zipUI(){const c=cfg(),dirs=new Set(S.files.flatMap(f=>f.name.split('/').slice(0,-1).map((_,i,a)=>a.slice(0,i+1).join('/'))));
 $('#uz').innerHTML=`<div class="card"><div class="item"><div class="g"><div class="t mono">${esc(S.zipName)}</div><div class="mu">${sz(S.zipSize)} · ${S.files.length} files · ${dirs.size} folders</div></div><button class="btn s d" data-act="rmzip">Remove ZIP</button></div>
 <div class="two"><div><label>ZIP structure</label><select id="mode" data-seg><option value="preserve" ${c.mode==='preserve'?'selected':''}>Preserve</option><option value="root" ${c.mode==='root'?'selected':''}>Remove root folder</option></select></div><div><label>Destination folder (empty = root)</label><input id="dest" class="mono" placeholder="e.g. src or uploads/v2"></div>
 <div><label>If file exists</label><select id="conf" data-seg><option value="replace" ${c.conflict==='replace'?'selected':''}>Replace</option><option value="skip" ${c.conflict==='skip'?'selected':''}>Skip</option></select></div><div><label>Commit message</label><input id="msg" value="${esc(c.msg)}"></div></div></div>
 <div class="card"><div class="row" style="margin-top:0"><input id="fq" placeholder="Search filename…" style="flex:1"><button class="btn s" data-act="selall">Select all</button><button class="btn s" data-act="selnone">Deselect all</button></div><div class="files" id="fl"></div></div>
 <div class="actionbar"><span class="mu mono" id="sum"></span><button class="btn p" id="go" data-act="start">${ic('upload',17)} Upload to GitHub</button></div>`;fileList()}
function fileList(){const q=($('#fq')?.value||'').toLowerCase();const p=plan(),pm=new Map(p.map(x=>[x.f,x.path]));
 $('#fl').innerHTML=S.files.map((f,i)=>({f,i})).filter(x=>x.f.name.toLowerCase().includes(q)).slice(0,300).map(x=>`<label><input type="checkbox" data-i="${x.i}" ${x.f.sel?'checked':''}><span>${esc(pm.get(x.f)||x.f.name)}</span><span class="mu" style="margin-left:auto">${sz(x.f.size)}</span></label>`).join('');
 $('#sum').textContent=`${p.length} files · ${sz(p.reduce((a,x)=>a+x.f.size,0))} selected`}
async function start(){const R=S.repo,B=S.branch,p=plan(),conf=$('#conf').value,msg=$('#msg').value.trim()||'Upload project via RepoFast';
 if(!p.length)return toast('No files selected.','err');
 if(p.some(x=>!safe(x.path)))return toast('Destination path is invalid.','err');
 const total=p.length;let done=0,bytes=0,cur='';const ui=(op)=>{$('#uz').innerHTML=`<div class="card"><h3>Uploading to GitHub</h3><div class="bar"><i style="width:${Math.round(done/total*100)}%"></i></div><div class="mono mu">${esc(op)} · ${done}/${total} files · ${total-done} remaining · ${sz(bytes)}<br>${esc(cur)}</div></div>`};
 const rec=(o)=>LS.set('rf_hist',[{zip:S.zipName,repo:R,branch:B,count:total,date:Date.now(),...o},...hist()].slice(0,100));
 try{ui('Preparing');const ref=await gh(`/repos/${R}/git/ref/heads/${encodeURIComponent(B)}`),base=ref.object.sha,bc=await gh(`/repos/${R}/git/commits/${base}`);
  let items=p;if(conf==='skip'){ui('Checking existing files');const t=await gh(`/repos/${R}/git/trees/${bc.tree.sha}?recursive=1`);if(t.truncated)toast('Repository tree is large; some existing files may not be detected.','wn');const ex=new Set(t.tree.map(x=>x.path));items=p.filter(x=>!ex.has(x.path));if(items.length<p.length)toast(`${p.length-items.length} existing files skipped.`,'wn')}
  if(!items.length)throw Error('Nothing to upload (all files already exist).');
  const ents=[];await pool(items,4,async x=>{cur=x.path;ui('Creating Git blobs');const c=b64(await x.f.e.async('uint8array'));const b=await gh(`/repos/${R}/git/blobs`,{method:'POST',body:{content:c,encoding:'base64'}});ents.push({path:x.path,mode:'100644',type:'blob',sha:b.sha});done++;bytes+=x.f.size;ui('Creating Git blobs')});
  let ts=bc.tree.sha;for(let i=0;i<ents.length;i+=500){ui('Building Git tree');ts=(await gh(`/repos/${R}/git/trees`,{method:'POST',body:{base_tree:ts,tree:ents.slice(i,i+500)}})).sha}
  ui('Creating commit');const cm=await gh(`/repos/${R}/git/commits`,{method:'POST',body:{message:msg,tree:ts,parents:[base]}});
  ui('Updating branch');await gh(`/repos/${R}/git/refs/heads/${encodeURIComponent(B)}`,{method:'PATCH',body:{sha:cm.sha,force:false}});
  rec({ok:true,count:ents.length,sha:cm.sha,url:cm.html_url,msg});toast('Commit created successfully.');
  $('#uz').innerHTML=`<div class="card"><h3>${ic('ok')} Your project has been uploaded successfully.</h3><div class="mono mu">${esc(R)} @ ${esc(B)}<br>${ents.length} files · "${esc(msg)}"<br>Commit ${cm.sha}</div><div class="row"><a class="btn p" target="_blank" rel="noopener" href="https://github.com/${esc(R)}">View Repository</a><a class="btn" target="_blank" rel="noopener" href="${esc(cm.html_url)}">View Commit</a><button class="btn" data-act="again">Upload Another ZIP</button></div></div>`
 }catch(e){rec({ok:false,err:e.message});toast(e.message,'err');$('#uz').innerHTML=`<div class="card"><h3>${ic('warn')} Upload failed</h3><p class="mu">${esc(e.message)}</p><p class="mu">No changes were made to the branch unless the final step succeeded. Blobs already created are harmless.</p><button class="btn" data-act="again">Try again</button></div>`}}
// ---------- explorer helpers ----------
async function getFile(p){return gh(`/repos/${S.repo}/contents/${ep(p)}?ref=${encodeURIComponent(S.branch)}`)}
const TEXT=/\.(html?|css|js|mjs|json|md|txt|svg|xml|ya?ml|ts|tsx|jsx|py|sh|env|gitignore|toml|csv|ini)$/i;
async function put(path,content,sha,message){return gh(`/repos/${S.repo}/contents/${ep(path)}`,{method:'PUT',body:{message,content,branch:S.branch,...(sha?{sha}:{})}})}
// ---------- events ----------
const A={
 menu(){document.body.classList.toggle('m')},
 theme(){const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('rf_theme',t)},
 reload(){S.repos=[];render()},async more(){await loadRepos(true);render()},
 manage(e){setRepo(e.dataset.r);go('explorer')},cd(e){S.path=e.dataset.p;render()},
 showtok(e){const i=$('#tok');i.type=i.type==='password'?'text':'password';e.textContent=i.type==='password'?'Show':'Hide'},
 async connect(e){const v=$('#tok').value.trim();if(!v&&!e.dataset.t)return toast('Enter a token first.','err');const old=S.token;if(v)S.token=v;
  try{S.user=await gh('/user');localStorage.setItem('rf_token',S.token);$('#tok')&&($('#tok').value='');toast('Connected as '+S.user.login);S.repos=[];render()}catch(x){S.token=old;toast(x.message,'err')}},
 disc(){localStorage.removeItem('rf_token');S.token='';S.user=null;S.repos=[];S.repo='';toast('Disconnected. Token removed from this device.');render()},
 saveset(){LS.set('rf_set',{msg:$('#s_msg').value,mode:$('#s_mode').value,conflict:$('#s_conf').value,max:+$('#s_max').value||100});toast('Preferences saved.')},
 newrepo(){modal(`<h3>Create Repository</h3><form data-form="repo"><label>Repository name *</label><input name="name" required pattern="[A-Za-z0-9._-]+"><label>Description</label><input name="description"><div class="two"><div><label>Visibility</label><select name="private"><option value="0">Public</option><option value="1">Private</option></select></div><div><label>.gitignore template</label><input name="gi" placeholder="e.g. Node"></div></div><label>License</label><input name="lic" placeholder="e.g. mit"><label class="c"><input type="checkbox" name="readme" checked> Initialize with README</label><div class="row"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn p">Create Repository</button></div></form>`)},
 close(){modal('')},
 async edit(e){const p=e.dataset.p;if(!TEXT.test(p))return toast('Preview not available. Use Download.','wn');try{const f=await getFile(p);if(f.size>1048576)throw Error('File too large to edit here.');modal(`<h3 class="mono">${esc(p)}</h3><textarea class="code" id="ed" spellcheck="false">${esc(unb64(f.content))}</textarea><div class="row"><button class="btn" data-act="close">Discard Changes</button><button class="btn p" data-act="save" data-p="${esc(p)}" data-s="${f.sha}">Save Changes</button></div>`)}catch(x){toast(x.message,'err')}},
 async save(e){try{await put(e.dataset.p,b64(new TextEncoder().encode($('#ed').value)),e.dataset.s,'Update '+e.dataset.p+' via RepoFast');toast('File saved.');modal('');render()}catch(x){toast(x.message,'err')}},
 async del(e){if(!confirm('Delete '+e.dataset.p+'?'))return;try{await gh(`/repos/${S.repo}/contents/${ep(e.dataset.p)}`,{method:'DELETE',body:{message:'Delete '+e.dataset.p+' via RepoFast',sha:e.dataset.s,branch:S.branch}});toast('File deleted.');render()}catch(x){toast(x.message,'err')}},
 async ren(e){const o=e.dataset.p,n=prompt('New path:',o);if(!n||n===o||!safe(n))return;try{const f=await getFile(o);await put(n,f.content.replace(/\n/g,''),null,`Rename ${o} to ${n} via RepoFast`);await gh(`/repos/${S.repo}/contents/${ep(o)}`,{method:'DELETE',body:{message:`Remove ${o} (renamed)`,sha:f.sha,branch:S.branch}});toast('File renamed (2 commits).');render()}catch(x){toast(x.message,'err')}},
 async newfile(){const n=prompt('File path (use folder/name.ext; add folder/.gitkeep to create a folder):',(S.path?S.path+'/':''));if(!n||!safe(n))return;try{await put(n,'',null,'Create '+n+' via RepoFast');toast('File created.');render()}catch(x){toast(x.message,'err')}},
 addfile(){$('#af').click()},
 clearh(){if(confirm('Clear local upload history?')){localStorage.removeItem('rf_hist');render()}},
 rmzip(){S.files=[];render()},again(){S.files=[];render()},
 selall(){S.files.forEach(f=>f.sel=true);fileList()},selnone(){S.files.forEach(f=>f.sel=false);fileList()},start
};
document.addEventListener('click',e=>{const t=e.target.closest('[data-act],[data-go]');if(!t)return;if(t.dataset.go)return go(t.dataset.go);if(t.tagName==='A'&&t.getAttribute('href')==='#')e.preventDefault();A[t.dataset.act]?.(t)});
document.addEventListener('submit',async e=>{if(e.target.dataset.form!=='repo')return;e.preventDefault();const f=new FormData(e.target),b={name:f.get('name'),description:f.get('description'),private:f.get('private')==='1',auto_init:!!f.get('readme')};if(f.get('gi'))b.gitignore_template=f.get('gi');if(f.get('lic'))b.license_template=f.get('lic');
 try{const r=await gh('/user/repos',{method:'POST',body:b});toast('Repository created successfully.');modal(`<h3>${ic('ok')} ${esc(r.full_name)}</h3><p class="mono">${esc(r.html_url)}</p><div class="row"><a class="btn p" target="_blank" rel="noopener" href="${esc(r.html_url)}">Open Repository</a><button class="btn" data-act="close">Close</button></div>`);S.repos=[];await loadRepos();setRepo(r.full_name);if(S.route==='repos')render()}catch(x){toast(x.message,'err')}});
document.addEventListener('change',async e=>{const t=e.target;
 if(t.id==='repoSel'){setRepo(t.value);render()}else if(t.id==='branchSel'){S.branch=t.value;S.path='';render()}
 else if(t.id==='vis'){S.vis=t.value;$('#rl').innerHTML=repoList()}else if(t.id==='zf'&&t.files[0])loadZip(t.files[0]);
 else if(t.dataset.i!==undefined){S.files[+t.dataset.i].sel=t.checked;fileList()}else if(t.id==='mode'||t.id==='dest')fileList();
 else if(t.id==='hf'){const h=hist().filter(x=>t.value==='All'||(t.value==='Successful')===x.ok);$('#hl').innerHTML=histRows(h)}
 else if(t.id==='af'&&t.files[0]){const f=t.files[0],p=(S.path?S.path+'/':'')+f.name;try{let sha;try{sha=(await getFile(p)).sha}catch{}await put(p,b64(new Uint8Array(await f.arrayBuffer())),sha,'Upload '+f.name+' via RepoFast');toast('File uploaded.');render()}catch(x){toast(x.message,'err')}}});
document.addEventListener('input',e=>{if(e.target.id==='q'){S.q=e.target.value;$('#rl').innerHTML=repoList()}else if(e.target.id==='fq'||e.target.id==='dest')fileList()});
document.addEventListener('dragover',e=>{const d=e.target.closest('#drop');if(d){e.preventDefault();d.classList.add('on')}});
document.addEventListener('dragleave',e=>e.target.closest?.('#drop')?.classList.remove('on'));
document.addEventListener('drop',e=>{const d=e.target.closest('#drop');if(d){e.preventDefault();d.classList.remove('on');e.dataTransfer.files[0]&&loadZip(e.dataTransfer.files[0])}});
document.addEventListener('click',e=>{if(e.target.closest('#drop'))$('#zf').click()});
// ---------- shell ----------
function go(r){S.route=r;S.path='';document.body.classList.remove('m');location.hash=r;render()}
async function render(){
 if(!S.user&&S.token){try{S.user=await gh('/user')}catch(e){toast(e.message,'err')}}
 if(!S.user)S.route='settings';document.body.classList.toggle('out',!S.user);
 $('#nav').innerHTML=NAV.map((n,i)=>(i===0||NAV[i-1][3]!==n[3]?`<h6>${n[3]}</h6>`:'')+`<a class="${n[0]===S.route?'on':''}" data-go="${n[0]}">${ic(n[2])}${n[1]}</a>`).join('');
 const cur=NAV.find(n=>n[0]===S.route);$('#title').textContent=cur[1];$('#crumb').textContent='RepoFast / '+cur[3];
 $('#me').innerHTML=S.user?`<div class="u"><img src="${esc(S.user.avatar_url)}" alt=""><div><b>${esc(S.user.login)}</b><div class="mu" style="font-size:11px">Connected</div></div></div><button class="btn s" data-act="disc">Disconnect</button>`:'<span class="mu">Not connected</span>';
 $('#burger').innerHTML=ic('menu');$('#themeBtn').innerHTML=ic('sun');
 const v=$('#view');v.innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk"></div>';
 try{v.innerHTML=await V[S.route]();if(S.route==='upload'&&S.files.length)zipUI()}catch(e){v.innerHTML=`<div class="card empty">${esc(e.message)}</div>`;toast(e.message,'err')}}
function enhance(){document.querySelectorAll('select:not([data-e])').forEach(s=>{s.dataset.e=1;const w=document.createElement('div'),seg=s.dataset.seg!==undefined;w.className='dd'+(seg?' seg':'');w.style.width=s.style.width||'100%';if(s.style.width==='auto')w.style.minWidth='170px';s.before(w);w.append(s);
 if(seg){const paint=()=>w.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===s.value));[...s.options].forEach(o=>{const b=document.createElement('button');b.type='button';b.dataset.v=o.value;b.textContent=o.text;b.onclick=()=>{s.value=o.value;paint();s.dispatchEvent(new Event('change',{bubbles:true}))};w.append(b)});paint();return}
 const b=document.createElement('button');b.type='button';b.className='dd-b';const lab=()=>{b.innerHTML=`<span>${esc(s.selectedOptions[0]?.text||'Select')}</span>${ic('chev',16)}`};lab();w.append(b);b.onclick=e=>{e.stopPropagation();menu(s,b,lab)}})}
let M;const closeM=()=>{M?.remove();M=null};
function menu(s,b,lab){const same=M&&M.owner===b;closeM();if(same)return;const opts=[...s.options];M=document.createElement('div');M.className='dd-m';M.owner=b;
 M.innerHTML=(opts.length>6?'<input class="dd-q" placeholder="Search…">':'')+'<div class="dd-l"></div>';const L=M.lastChild;
 const draw=q=>{L.innerHTML=opts.filter(o=>o.text.toLowerCase().includes(q)).map(o=>`<div class="dd-o${o.value===s.value?' on':''}" data-v="${esc(o.value)}"><span>${esc(o.text)}</span>${o.value===s.value?ic('check',16):''}</div>`).join('')||'<div class="dd-o mu">No results</div>'};draw('');
 document.body.append(M);const r=b.getBoundingClientRect();M.style.minWidth=Math.max(r.width,200)+'px';M.style.left=Math.max(8,Math.min(r.left,innerWidth-M.offsetWidth-8))+'px';const h=M.offsetHeight;M.style.top=(r.bottom+h+12>innerHeight&&r.top>h?r.top-h-6:r.bottom+6)+'px';
 const q=M.querySelector('.dd-q');q?.focus();q?.addEventListener('input',()=>draw(q.value.toLowerCase()));
 M.onclick=e=>{const o=e.target.closest('.dd-o[data-v]');if(!o)return;s.value=o.dataset.v;lab();closeM();s.dispatchEvent(new Event('change',{bubbles:true}))}}
document.addEventListener('mousedown',e=>{if(M&&!M.contains(e.target)&&!e.target.closest('.dd-b'))closeM()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()});addEventListener('resize',closeM);
new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
document.documentElement.dataset.theme=localStorage.getItem('rf_theme')||'dark';
const h0=location.hash.slice(1);if(NAV.some(n=>n[0]===h0))S.route=h0;
render();
