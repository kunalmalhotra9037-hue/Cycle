/* =====================================================================
   CYCLE BEAT — Supabase sync

   Loaded after the main app script, so it can see S, KEY, save(), toast()
   and the render functions.

   Design: the phone stays the source of truth. Everything is written to
   IndexedDB first and the app keeps working with no signal. This layer
   pushes whatever is pending whenever the network allows, and never
   blocks the AE.
   ===================================================================== */
(function(){

const CFG = window.CONFIG || {};
const OFFLINE = !CFG.url || !CFG.anonKey;

let sb = null, user = null, profile = null;
let flushTimer = null, flushing = false, pending = false;

/* ------------------------------------------------------------ status pill */
const pill = document.createElement('button');
pill.id = 'syncPill';
pill.type = 'button';
document.querySelector('.topbar').appendChild(pill);

const css = document.createElement('style');
css.textContent = `
#syncPill{margin-left:10px;padding:5px 10px;border-radius:14px;font-size:11px;
  font-family:"IBM Plex Sans",sans-serif;font-weight:500;white-space:nowrap;
  background:rgba(255,255,255,.1);color:#8A97AB;border:1px solid rgba(255,255,255,.15)}
#syncPill.ok{color:#7BE0A8;border-color:rgba(123,224,168,.35)}
#syncPill.busy{color:#F5C46B;border-color:rgba(245,196,107,.35)}
#syncPill.bad{color:#FF9A9D;border-color:rgba(255,154,157,.35)}
#gate{position:fixed;inset:0;z-index:2000;background:var(--ink);color:#fff;
  display:flex;align-items:center;justify-content:center;padding:24px}
#gate .box{width:100%;max-width:360px}
#gate h1{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:30px;
  letter-spacing:.03em;margin:0 0 4px}
#gate h1 span{color:var(--signal)}
#gate p{color:#8A97AB;font-size:13.5px;margin:0 0 22px;line-height:1.5}
#gate label{display:block;font-family:"Barlow Condensed",sans-serif;font-weight:600;
  text-transform:uppercase;letter-spacing:.09em;font-size:13px;color:#8A97AB;margin:0 0 5px}
#gate input{width:100%;padding:12px;border-radius:10px;border:1.5px solid #2C3A4E;
  background:#16202E;color:#fff;font-size:16px;margin-bottom:14px}
#gate input:focus{outline:none;border-color:var(--signal)}
#gate .msg{font-size:13px;margin-top:12px;min-height:18px;line-height:1.45}
#gate .msg.bad{color:#FF9A9D}
#resumeBar{background:var(--signal-soft);border:1px solid var(--signal);
  border-radius:10px;padding:11px 13px;margin:0 0 14px;font-size:13px;line-height:1.5}
#resumeBar button{margin-top:8px;padding:7px 12px;border-radius:8px;background:var(--ink);
  color:#fff;font-size:13px;font-weight:600}
`;
document.head.appendChild(css);

function setPill(state, text){
  pill.className = state;
  pill.textContent = text;
}

/* ------------------------------------------------------------ local mode */
if(OFFLINE){
  setPill('', 'On this phone only');
  pill.title = 'No Supabase project configured. Add one in config.js to sync to the branch.';
  return;
}

sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
  auth:{persistSession:true, autoRefreshToken:true}
});
window.SB = sb;

/* ------------------------------------------------------------- login gate */
const gate = document.createElement('div');
gate.id = 'gate';
gate.innerHTML = `
  <div class="box">
    <h1>CYCLE<span>·</span>BEAT</h1>
    <p>Sign in so your remarks and photos reach the branch. Ask your BM for a login.</p>
    <label for="gEmail">Email</label>
    <input id="gEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="none">
    <label for="gPass">Password</label>
    <input id="gPass" type="password" autocomplete="current-password">
    <button class="btn btn-signal btn-block" id="gGo">Sign in</button>
    <div class="msg" id="gMsg"></div>
    <button class="btn btn-ghost btn-block" id="gSkip"
      style="margin-top:14px;background:transparent;border-color:#2C3A4E;color:#8A97AB">
      Work offline on this phone
    </button>
  </div>`;

function showGate(){ document.body.appendChild(gate); }
function hideGate(){ gate.remove(); }

gate.querySelector('#gGo').onclick = async () => {
  const email = gate.querySelector('#gEmail').value.trim();
  const pass  = gate.querySelector('#gPass').value;
  const msg   = gate.querySelector('#gMsg');
  if(!email || !pass){ msg.className = 'msg bad'; msg.textContent = 'Enter both your email and password.'; return; }
  const btn = gate.querySelector('#gGo');
  btn.innerHTML = '<span class="spin"></span> Signing in…'; btn.disabled = true;
  const {error} = await sb.auth.signInWithPassword({email, password:pass});
  btn.textContent = 'Sign in'; btn.disabled = false;
  if(error){
    msg.className = 'msg bad';
    const m = error.message || '';
    if(/failed to fetch|networkerror|load failed/i.test(m) || !navigator.onLine){
      msg.textContent = 'No connection to the server. Tap "Work offline on this phone" — '
        + 'your remarks and photos are kept and will sync once you sign in on a better signal.';
    } else if(/invalid login/i.test(m)){
      msg.textContent = 'That email and password do not match. Check with your BM.';
    } else if(/email not confirmed/i.test(m)){
      msg.textContent = 'This login has not been activated yet. Ask your BM to confirm it.';
    } else {
      msg.textContent = m;
    }
  }
};
gate.querySelector('#gPass').addEventListener('keydown', e => {
  if(e.key === 'Enter') gate.querySelector('#gGo').click();
});
gate.querySelector('#gSkip').onclick = () => {
  hideGate();
  setPill('', 'On this phone only');
  pill.title = 'Not signed in. Nothing is syncing to the branch.';
};

pill.onclick = async () => {
  if(!user){ showGate(); return; }
  if(!confirm('Sign out? Anything not yet synced stays on this phone.')) return;
  await sb.auth.signOut();
};

/* ---------------------------------------------------------- session wiring */
sb.auth.onAuthStateChange(async (_evt, session) => {
  user = session?.user || null;
  if(user){
    hideGate();
    setPill('ok', 'Synced');
    const {data} = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = data;
    if(profile){
      const nameEl = document.querySelector('#aeName');
      const brEl   = document.querySelector('#aeBranch');
      if(nameEl && !nameEl.value) nameEl.value = profile.full_name || '';
      if(brEl) brEl.value = profile.branch || CFG.branch || 'SHYD';
    }
    pill.title = user.email + ' — tap to sign out';
    schedule(400);
    offerResume();
  } else {
    profile = null;
    setPill('', 'Signed out');
    showGate();
  }
});

sb.auth.getSession().then(({data}) => { if(!data.session) showGate(); });

/* ----------------------------------------------------- wrap the save path
   save() is already called by the app on every meaningful change: status
   taps, photos, route builds, resets. Wrapping it means one hook covers
   the lot without touching the tested code.                              */
const _save = save;
save = function(){
  _save();
  if(user && S.beat.length) schedule();
};

function schedule(ms){
  pending = true;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms ?? 2500);
}

window.addEventListener('online',  () => { if(user && pending) schedule(300); });
window.addEventListener('offline', () => setPill('bad', 'Offline — queued'));

/* ------------------------------------------------------------------ flush */
async function flush(){
  if(!user || flushing || !S.beat.length) return;
  if(!navigator.onLine){ setPill('bad', 'Offline — queued'); return; }
  flushing = true;
  setPill('busy', 'Syncing…');
  try{
    if(!S.beatId) S.beatId = crypto.randomUUID();

    // 1. the beat header
    const beatRow = {
      id: S.beatId,
      user_id: user.id,
      beat_name: (document.querySelector('#aeBeat')?.value || '').trim() || null,
      branch:    (document.querySelector('#aeBranch')?.value || '').trim() || null,
      ae_name:   (document.querySelector('#aeName')?.value || '').trim() || null,
      start_label: S.start?.label || null,
      start_lat:   S.start?.lat ?? null,
      start_lon:   S.start?.lon ?? null,
      end_label:   S.end?.label || null,
      end_lat:     S.end?.lat ?? null,
      end_lon:     S.end?.lon ?? null,
      radius_km:   S.radius,
      route_km:    S.routeKm ? +S.routeKm.toFixed(2) : null,
      route_min:   S.routeMin ?? null,
      planned_stops: S.beat.length
    };
    const {error: bErr} = await sb.from('beats').upsert(beatRow);
    if(bErr) throw bErr;

    // 2. any photos not yet uploaded
    let uploaded = 0;
    for(const o of S.beat){
      const lg = S.logs[KEY(o)];
      if(!lg?.photos?.length) continue;
      for(let i = 0; i < lg.photos.length; i++){
        const ph = lg.photos[i];
        if(ph.remote) continue;
        const blob = dataURLtoBlob(ph.d);
        const path = `${user.id}/${S.beatId}/${KEY(o)}-${Date.now()}-${i}.jpg`;
        const {error} = await sb.storage.from('visit-photos')
          .upload(path, blob, {contentType:'image/jpeg', upsert:false});
        if(error) throw error;
        ph.remote = path;
        uploaded++;
      }
    }
    if(uploaded) _save();

    // 3. every visit row, in one upsert
    const rows = S.beat.map((o, i) => {
      const lg = S.logs[KEY(o)] || {};
      return {
        beat_id: S.beatId,
        user_id: user.id,
        seq: i + 1,
        outlet_key: KEY(o),
        outlet_id: o.id,
        state: o.st,
        outlet_name: o.name,
        outlet_type: o.type,
        region: o.region,
        lat: o.lat,
        lon: o.lon,
        distance_km: o._d != null ? +o._d.toFixed(2) : null,
        status: lg.status || 'pending',
        remarks: (lg.remarks || '').trim() || null,
        photo_paths: (lg.photos || []).filter(p => p.remote).map(p => p.remote)
      };
    });
    const {error: vErr} = await sb.from('visits')
      .upsert(rows, {onConflict:'beat_id,outlet_key'});
    if(vErr) throw vErr;

    pending = false;
    setPill('ok', uploaded ? `Synced · ${uploaded} photo${uploaded>1?'s':''}` : 'Synced');
  }catch(e){
    console.error('sync', e);
    const net = /failed to fetch|networkerror|load failed/i.test(e.message || '') || !navigator.onLine;
    setPill('bad', net ? 'Offline — queued' : 'Sync failed — will retry');
    pill.title = (net ? 'No connection. Your work is saved on this phone and will go up automatically.'
                      : (e.message || 'Unknown error')) + ' — tap to retry';
    setTimeout(() => { if(pending) schedule(8000); }, 8000);
  }finally{
    flushing = false;
  }
}

function dataURLtoBlob(d){
  const [head, b64] = d.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type:mime});
}

/* ------------------------------------------- resume a beat from the server
   For when an AE picks up a different phone, or clears their browser.     */
async function offerResume(){
  if(S.beat.length) return;                       // local beat already loaded
  const {data} = await sb.from('beats')
    .select('id,beat_name,created_at,planned_stops')
    .is('closed_at', null)
    .order('created_at', {ascending:false})
    .limit(1);
  if(!data?.length) return;
  const b = data[0];
  const host = document.querySelector('#tab-plan .panel');
  if(!host || document.querySelector('#resumeBar')) return;
  const bar = document.createElement('div');
  bar.id = 'resumeBar';
  const when = new Date(b.created_at).toLocaleDateString('en-IN',
    {day:'2-digit', month:'short'});
  bar.innerHTML = `You have an open beat on the server — <b>${b.beat_name || 'unnamed'}</b>,
    ${b.planned_stops || 0} stops, started ${when}.
    <button id="resumeGo">Load it onto this phone</button>`;
  host.insertBefore(bar, host.firstChild);
  bar.querySelector('#resumeGo').onclick = () => pullBeat(b.id, bar);
}

async function pullBeat(beatId, bar){
  const btn = bar.querySelector('#resumeGo');
  btn.innerHTML = '<span class="spin"></span> Loading…'; btn.disabled = true;
  try{
    const [{data: b}, {data: vs}] = await Promise.all([
      sb.from('beats').select('*').eq('id', beatId).single(),
      sb.from('visits').select('*').eq('beat_id', beatId).order('seq')
    ]);
    S.beatId = b.id;
    S.radius = b.radius_km || S.radius;
    S.routeKm = b.route_km ? +b.route_km : null;
    S.routeMin = b.route_min;
    if(b.start_lat != null) S.start = {lat:b.start_lat, lon:b.start_lon, label:b.start_label};
    if(b.end_lat   != null) S.end   = {lat:b.end_lat,   lon:b.end_lon,   label:b.end_label};

    S.beat = vs.map(v => ({
      id:v.outlet_id, name:v.outlet_name, lat:v.lat, lon:v.lon,
      type:v.outlet_type, region:v.region, st:v.state,
      _d: v.distance_km != null ? +v.distance_km : null
    }));
    S.logs = {};
    for(const v of vs){
      const photos = [];
      for(const path of (v.photo_paths || [])){
        try{
          const {data: blob} = await sb.storage.from('visit-photos').download(path);
          if(blob) photos.push(await blobToPhoto(blob, path));
        }catch(e){ /* a missing photo should not block the resume */ }
      }
      S.logs[v.outlet_key] = {status:v.status, remarks:v.remarks || '', photos};
    }

    const nm = document.querySelector('#aeName'), bn = document.querySelector('#aeBeat'),
          br = document.querySelector('#aeBranch');
    if(nm) nm.value = b.ae_name || '';
    if(bn) bn.value = b.beat_name || '';
    if(br) br.value = b.branch || 'SHYD';

    drawAnchors(); drawBeat(); renderStops(); renderStats(); updateReadout();
    if(S.beat.length) map.fitBounds(L.latLngBounds(S.beat.map(o=>[o.lat,o.lon])).pad(.2));
    _save();
    bar.remove();
    toast(`Loaded ${S.beat.length} stops from the server`);
    go('stops');
  }catch(e){
    console.error(e);
    btn.textContent = 'Load it onto this phone'; btn.disabled = false;
    toast('That beat could not be loaded. Check your connection.', true);
  }
}

function blobToPhoto(blob, path){
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => res({d:r.result, w:img.width, h:img.height, remote:path});
      img.onerror = () => res({d:r.result, w:800, h:600, remote:path});
      img.src = r.result;
    };
    r.readAsDataURL(blob);
  });
}

/* --------------------------------------------------- close a finished beat */
window.closeBeat = async function(){
  if(!user || !S.beatId) return;
  await flush();
  await sb.from('beats').update({closed_at:new Date().toISOString()}).eq('id', S.beatId);
  toast('Beat closed and filed');
};

})();
