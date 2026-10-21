p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''    const frames = model.frames || [];
    const animated = frames.length >= 2;'''
new='''    const frames = model.frames || [];
    const animated = frames.length >= 2;
    perfStats.frames = frames.length;
    perfStats.animated = animated;'''
assert old in c
c=c.replace(old,new,1)
old2='''    perfLog('anim-probe', {
      frames: frames.length,'''
new2='''    perfStats.frameIndexed = frameGroups ? frameGroups.reduce(function (n, g) { return n + g.length; }, 0) : 0;
    perfStats.windowMode = windowMode;
    perfStats.primitiveLineMode = primitiveLineMode;
    perfStats.primitiveMode = primitiveMode;
    perfLog('anim-probe', {
      frames: frames.length,'''
assert old2 in c
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('stats fields added')
