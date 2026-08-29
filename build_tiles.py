"""
Converts Unserviced_Outlets_Cycle.xlsx into 0.5-degree geographic tiles
so the field app only downloads outlets near the AE's location.
"""
import pandas as pd, json, os, shutil

SRC = '/mnt/user-data/uploads/Unserviced_Outlets_Cycle.xlsx'
OUT = '/home/claude/build/cycle-beat/data'
STEP = 0.5

df = pd.read_excel(SRC)
df.columns = ['State', 'ID', 'Name', 'Type', 'Region', 'Lat', 'Lon']

df['Name'] = df.Name.astype(str).str.strip().str.slice(0, 60)
df['Lat'] = df.Lat.round(5)
df['Lon'] = df.Lon.round(5)

types = sorted(df.Type.unique())
regions = sorted(df.Region.unique())
states = sorted(df.State.unique())
ti = {t: i for i, t in enumerate(types)}
ri = {r: i for i, r in enumerate(regions)}
si = {s: i for i, s in enumerate(states)}

df['tx'] = (df.Lon / STEP).apply(lambda v: int(v // 1))
df['ty'] = (df.Lat / STEP).apply(lambda v: int(v // 1))

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

tiles = []
for (ty, tx), sub in df.groupby(['ty', 'tx']):
    # [id, name, lat*1e5, lon*1e5, typeIdx, regionIdx, stateIdx]
    rows = [[int(r.ID), r.Name, int(round(r.Lat * 100000)), int(round(r.Lon * 100000)),
             ti[r.Type], ri[r.Region], si[r.State]] for r in sub.itertuples()]
    key = f'{ty}_{tx}'
    with open(f'{OUT}/t{key}.json', 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'), ensure_ascii=False)
    tiles.append(key)

meta = {
    'step': STEP,
    'count': int(len(df)),
    'types': types,
    'regions': regions,
    'states': states,
    'tiles': sorted(tiles),
}
with open(f'{OUT}/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)

sizes = [os.path.getsize(f'{OUT}/t{k}.json') for k in tiles]
print(f'outlets   : {len(df):,}')
print(f'tiles     : {len(tiles)}')
print(f'largest   : {max(sizes)/1024:.0f} KB')
print(f'total     : {sum(sizes)/1024/1024:.1f} MB')
print(f'types     : {types}')
print(f'states    : {states}')
