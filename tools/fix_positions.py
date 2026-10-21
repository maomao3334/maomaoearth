p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''  function groundHeightAt(lon, lat) {
    if (!terrainEnabled()) return 0;
    return window.LETerrain.heightAt(lon, lat);
  }'''
new='''  function groundHeightAt(lon, lat) {
    if (!terrainEnabled()) return 0;
    const h = window.LETerrain.heightAt(lon, lat);
    return isFinite(h) ? h : 0;
  }'''
assert old in c
c=c.replace(old,new,1)
old2='''  function positionsFor(coords, altitudeMode) {
    const positions = new Array(coords.length);
    for (let i = 0; i < coords.length; i++) {
      positions[i] = C.Cartesian3.fromDegrees(coords[i].lon, coords[i].lat, heightFor(coords[i], altitudeMode));
    }
    return positions;
  }'''
new2='''  function positionsFor(coords, altitudeMode) {
    const positions = [];
    for (let i = 0; i < coords.length; i++) {
      const h = heightFor(coords[i], altitudeMode);
      const position = C.Cartesian3.fromDegrees(
        coords[i].lon,
        coords[i].lat,
        isFinite(h) ? h : 0
      );
      if (position) positions.push(position);
    }
    return positions;
  }'''
assert old2 in c
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('positionsFor sanitized')
