import sqlite3, os
for f in ['vector-sample.mbtiles','vector-3857.mbtiles','vector-4326.mbtiles','raster-4326.mbtiles','wind-area.mbtiles']:
 p=os.path.join(r'G:\sh\local-earth\data\samples\mbtiles',f)
 print('---',f, os.path.getsize(p) if os.path.exists(p) else 'missing')
 if os.path.exists(p):
  con=sqlite3.connect(p); print(dict(con.execute('select name,value from metadata'))); print('tiles',con.execute('select count(*),min(zoom_level),max(zoom_level) from tiles').fetchone()); con.close()
