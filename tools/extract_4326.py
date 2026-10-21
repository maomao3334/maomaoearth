import sqlite3,os
p=r'G:\sh\local-earth\data\samples\mbtiles\raster-4326.mbtiles'
con=sqlite3.connect(p)
for r in con.execute('select zoom_level,tile_column,tile_row,tile_data from tiles'):
 z,x,y,d=r; open(os.path.join(r'G:\sh\local-earth\docs\testdata',f'4326_{z}_{x}_{y}.png'),'wb').write(d); print(z,x,y,len(d))
con.close()
