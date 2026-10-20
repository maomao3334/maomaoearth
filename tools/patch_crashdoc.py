p=r'G:\sh\local-earth\docs\CRASH-FIX.md'
c=open(p,encoding='utf-8').read()
add="""
## 追加：第二类崩溃（Too many properties to enumerate）

用户“全开”后再次崩溃，堆栈为：

```
RangeError: Too many properties to enumerate
  at computeRhumbLineSubdivision
  at PolygonGeometry.createGeometry
```

同样是 RHUMB 细分，但来源不同：**main.js 启动时加载的示例国界（ne_110m_admin_0_countries）** 没有经过清洗，其 288 个面仍是 `ArcType.RHUMB`；缩放到西藏/俄罗斯等大面时，`computeRhumbLineSubdivision` 生成的点数超出数组上限。

修复：
- `js/importers.js` 导出 `LEImports.sanitizeDataSource()`
- `js/main.js` 在加载示例国界/地名后立即调用清洗
- `js/kml-native.js` 的 Polygon 显式设置 `arcType: GEODESIC`（拖入含大面的 KML 也不会再触发）
- 所有 GeoJSON / KML 回退数据源的 polygon/polyline 均统一为 GEODESIC

验证：`?cam=91,31,12000,-55&exag=2.3` + 风场 + 河流/湖泊/城市/详细国界 + 连续拖拽/缩放，`panel=false`、console error 为空（`docs/testdata/cdp-tibet-verify.log`）。

## 关于“浏览器性能上限”

不是浏览器性能限制，而是 Cesium 处理 RHUMB 大面几何时的数值溢出（会直接中断渲染，而不是变慢）。修复后不会再因数据量/缩放触发该异常；若未来仍出现渲染异常，console 会打印 `[Cesium renderError]` 完整堆栈。
"""
if '第二类崩溃' not in c:
    c += add
open(p,'w',encoding='utf-8',newline='').write(c)
print('CRASH-FIX updated')
