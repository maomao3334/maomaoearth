p=r'G:\sh\local-earth\js\kml-native.js'
c=open(p,encoding='utf-8').read()
old='''    if (depth !== 0 || folders.length < DOM_SPLIT_MIN_FOLDERS) return null;
    if (folders.some((folder) => folder.end < 0)) return null;'''
new='''    // 扁平大 KML（没有 Folder，13 万 Placemark 直接挂在 Document 下）：
    // 按 Placemark 连续块切片，每片都带上 Document 头部（Style/StyleMap），
    // 这样既有跨片样式，又能把单次 DOMParser 阻塞控制在几 MB。
    if (folders.length === 0) {
      const pmRe = /<Placemark\\b/g;
      const opens = [];
      let pm;
      while ((pm = pmRe.exec(text)) !== null) {
        if (pm.index >= contentStart && pm.index < contentEnd) opens.push(pm.index);
      }
      if (opens.length < 100) return null;
      const firstPm = opens[0];
      const header = text.slice(contentStart, firstPm);
      if (header.length > 1024 * 1024) return null;
      const target = 4 * 1024 * 1024;
      const parts = [];
      let chunkStart = firstPm;
      for (let i = 0; i < opens.length; i++) {
        const close = text.indexOf('</Placemark>', opens[i]);
        if (close < 0) return null;
        const chunkEnd = close + 12;
        const last = i === opens.length - 1;
        if (last || chunkEnd - chunkStart >= target) {
          parts.push({ kind: 'chunk', start: chunkStart, end: last ? contentEnd : chunkEnd });
          if (!last) chunkStart = opens[i + 1];
        }
      }
      if (parts.length < 2) return null;
      return { kmlOpen, docOpen, header, flat: true, parts };
    }
    if (depth !== 0 || folders.length < DOM_SPLIT_MIN_FOLDERS) return null;
    if (folders.some((folder) => folder.end < 0)) return null;'''
assert old in c
c=c.replace(old,new,1)
# parsePart wrapper include header for document/chunk parts
old2='''      const wrapper = asDocument
        ? plan.kmlOpen + plan.docOpen + content + (plan.docOpen ? '</Document>' : '') + '</kml>'
        : plan.kmlOpen + content + '</kml>';'''
new2='''      const header = asDocument && plan.header ? plan.header : '';
      const wrapper = asDocument
        ? plan.kmlOpen + plan.docOpen + header + content + (plan.docOpen ? '</Document>' : '') + '</kml>'
        : plan.kmlOpen + content + '</kml>';'''
assert old2 in c
c=c.replace(old2,new2,1)
# treat chunk as document
c=c.replace("const asDocument = part.kind === 'document';","const asDocument = part.kind === 'document' || part.kind === 'chunk';",1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('flat split patch applied')
