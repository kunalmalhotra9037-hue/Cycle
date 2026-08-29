/* =====================================================================
   CYCLE BEAT — outlet source

   Loaded after the main app script, before sync.js.

   If Supabase is configured and holds outlets, lookups go through the
   outlets_near / outlets_along functions: Postgres does the distance maths
   and returns only the nearest few hundred, which is far less to download
   than a map tile in a dense market.

   If Supabase is unreachable, empty, or not configured, this quietly hands
   back to the bundled tiles in ./data so the app still works with no signal.
   ===================================================================== */
(function(){

const CFG = window.CONFIG || {};
if(!CFG.url || !CFG.anonKey) return;          // local-only build, tiles it is

const client = window.supabase.createClient(CFG.url, CFG.anonKey, {
  auth:{persistSession:true, autoRefreshToken:true}
});

let remoteOk = null;      // null = untested, true = using Supabase, false = tiles
let cache = [];           // outlets from the last remote lookup
let lastTotal = 0;

const _loadArea  = loadArea;
const _tilesNear = tilesNear;
const _loadMeta  = loadMeta;

/* Startup. Prefer the bundled tiles for the filter lists because they need no
   network, but fall back to asking Supabase so the app can ship with no data/
   folder at all. */
loadMeta = async function(){
  try{
    await _loadMeta();
    if(S.meta) return;                       // tiles present, nothing more to do
  }catch(e){ /* no data/ folder — ask the server instead */ }

  try{
    const {data, error} = await client.rpc('outlet_meta');
    if(error) throw error;
    const m = Array.isArray(data) ? data[0] : data;
    if(!m || !m.types || !m.types.length) throw new Error('no outlets uploaded yet');

    S.meta = {step:0.5, types:m.types, regions:m.regions || [],
              states:m.states || [], tiles:[], tileSet:new Set()};
    remoteOk = true;
    m.types.forEach(t => S.types.add(t));
    renderTypeChips();
    document.querySelector('#loadedCount').textContent = '0';
  }catch(e){
    remoteOk = false;
    const m = e.message || '';
    toast(
      /failed to fetch|networkerror|load failed/i.test(m) || !navigator.onLine
        ? 'Cannot reach the outlet list. Check your connection and reload.'
      : /jwt|not authenticated|permission|row-level/i.test(m)
        ? 'Sign in to load the outlet list.'
      : 'No outlet list yet. Ask your BM to upload it in the admin portal.',
      true);
    console.warn('outlet_meta:', m || e);
  }
};

/* The app calls loadArea(centreLat, centreLon, spanKm) and then filters
   whatever tilesNear() hands back. We keep that contract and simply change
   where the outlets come from. */
const hasTiles = () => !!(S.meta && S.meta.tileSet && S.meta.tileSet.size);

loadArea = async function(lat, lon, km){
  if(remoteOk === false) return hasTiles() ? _loadArea(lat, lon, km) : undefined;

  const types = [...S.types];
  const allTypes = S.meta && types.length === S.meta.types.length;

  try{
    let res;
    if(S.start && S.end){
      res = await client.rpc('outlets_along', {
        p_lat1:S.start.lat, p_lon1:S.start.lon,
        p_lat2:S.end.lat,   p_lon2:S.end.lon,
        p_km:S.radius, p_types: allTypes ? null : types, p_limit:600
      });
    } else if(S.start){
      res = await client.rpc('outlets_near', {
        p_lat:S.start.lat, p_lon:S.start.lon,
        p_km:S.radius, p_types: allTypes ? null : types, p_limit:600
      });
    } else return _loadArea(lat, lon, km);

    if(res.error) throw res.error;

    // an empty table means nothing has been uploaded yet — use the tiles
    if(!res.data || (!res.data.length && remoteOk === null)){
      if(!(await hasOutlets())){ fallback(); return hasTiles() ? _loadArea(lat, lon, km) : undefined; }
    }

    remoteOk = true;
    lastTotal = res.data.length ? Number(res.data[0].total_count) : 0;
    cache = res.data.map(r => ({
      id:r.outlet_id, name:r.name, lat:r.lat, lon:r.lon,
      type:r.outlet_type, region:r.region, st:r.state
    }));
  }catch(e){
    console.warn('outlet lookup fell back to tiles:', e.message || e);
    if(!hasTiles()){
      toast('Cannot reach the outlet list. Check your connection.', true);
      return;
    }
    fallback();
    return _loadArea(lat, lon, km);
  }
};

tilesNear = function(lat, lon, km){
  if(remoteOk) return cache;
  return hasTiles() ? _tilesNear(lat, lon, km) : [];
};

async function hasOutlets(){
  const {count, error} = await client
    .from('outlets').select('outlet_key', {count:'exact', head:true});
  return !error && count > 0;
}

function fallback(){
  if(remoteOk === false) return;
  remoteOk = false;
  cache = [];
}

/* refresh() writes the map badge last, so correct it afterwards — otherwise
   the badge would report the trimmed count while the panel reports the true
   one, and the AE would not know which to believe. */
const _refresh = refresh;
refresh = async function(){
  await _refresh();
  if(remoteOk && lastTotal > S.inRange.length){
    const badge = document.querySelector('#mapBadge');
    if(badge) badge.textContent =
      `${lastTotal.toLocaleString('en-IN')} outlets · nearest ${S.inRange.length} loaded · ${S.beat.length} on beat`;
  }
};

/* Show the true in-range total even when the server trimmed the list. */
const _updateReadout = updateReadout;
updateReadout = function(){
  _updateReadout();
  if(remoteOk && lastTotal > S.inRange.length){
    const el = document.querySelector('#roInRange');
    if(el) el.textContent = lastTotal.toLocaleString('en-IN');
    const note = document.querySelector('#densityNote');
    if(note) note.innerHTML =
      `<b>${lastTotal.toLocaleString('en-IN')}</b> outlets sit inside ${S.radius} km — too many for one beat, `
      + `so the server sent the nearest ${S.inRange.length} and ${S.beat.length} are on the route. `
      + `Tighten the radius or drop outlet types to focus it.`;
  }
};

})();
