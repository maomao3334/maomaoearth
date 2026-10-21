p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
c=c.replace('''    let frameGroups = null;
    let windowMode = false;
    if (animated) {
      frameGroups = frames.map(() => []);
      let animatedGeometries = 0;''','''    let frameGroups = null;
    let windowMode = false;
    let animatedGeometries = 0;
    if (animated) {
      frameGroups = frames.map(() => []);
      animatedGeometries = 0;''',1)
old='''      if (primitiveLineMode) windowMode = false;
    }

    let primitives = null;'''
new='''      if (primitiveLineMode) windowMode = false;
    }
    perfLog('anim-probe', {
      frames: frames.length,
      animated: animated,
      frameIndexed: frameGroups ? frameGroups.reduce(function (n, g) { return n + g.length; }, 0) : 0,
      animatedGeometries: animatedGeometries,
      windowMode: windowMode,
      primitiveMode: primitiveMode,
      primitiveLineMode: primitiveLineMode,
    });

    let primitives = null;'''
assert old in c
c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('probe inserted')
