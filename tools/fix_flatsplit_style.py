p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''    if (text.length < DOM_SPLIT_MIN_BYTES) return null;
    // 有样式表时跨分片引用可能失效，禁用分片（避免错误着色/图标）
    if (text.indexOf('<Style') >= 0 || text.indexOf('<StyleMap') >= 0) return null;
    const head = text.slice(0, 16384);'''
new='''    if (text.length < DOM_SPLIT_MIN_BYTES) return null;
    // 扁平分片会把 Document 头部（含 Style/StyleMap）复制进每个分片，因此允许样式；
    // 顶层 Folder 分片暂不处理跨片样式引用，在下面单独返回 null。
    const hasStyles = text.indexOf('<Style') >= 0 || text.indexOf('<StyleMap') >= 0;
    const head = text.slice(0, 16384);'''
assert old in c
c=c.replace(old,new,1)
old2='''    if (depth !== 0 || folders.length < DOM_SPLIT_MIN_FOLDERS) return null;
    if (folders.some((folder) => folder.end < 0)) return null;'''
new2='''    if (hasStyles) return null;
    if (depth !== 0 || folders.length < DOM_SPLIT_MIN_FOLDERS) return null;
    if (folders.some((folder) => folder.end < 0)) return null;'''
assert old2 in c
c=c.replace(old2,new2,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('style gate fixed')
