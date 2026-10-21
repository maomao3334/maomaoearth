p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try {
        if (visible) le.viewer.scene.primitives.add(active);
        else le.viewer.scene.primitives.remove(active);
      } catch (err) { /* ignore */ }
    }'''
new='''    function setVisible(on) {
      visible = !!on;
      if (!active) return;
      try { le.viewer.scene.primitives.remove(active); } catch (err) { /* ignore */ }
      if (visible) {
        try { le.viewer.scene.primitives.add(active); } catch (err) { /* ignore */ }
      }
    }'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('setVisible fixed')
