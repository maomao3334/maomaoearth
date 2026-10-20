import base64, json, re, os
pairs=[(r'C:\Users\A\AppData\Local\Temp\dsh-spill-Kh3d8Y\session-35f4548edd54\367f964a8b92-mcp__rea__capture_browser_scenario.txt', r'G:\sh\local-earth\docs\testdata\kml-native-final-wind3d.png'),
       (r'C:\Users\A\AppData\Local\Temp\dsh-spill-Kh3d8Y\session-35f4548edd54\58e87a96fd30-mcp__rea__capture_browser_scenario.txt', r'G:\sh\local-earth\docs\testdata\kml-native-sample.png')]
for src,out in pairs:
    if not os.path.exists(src):
        print('missing', src); continue
    raw=open(src,encoding='utf-8',errors='replace').read()
    i=raw.find('"data_base64":"')
    if i<0:
        print('no screenshot', src); continue
    start=i+15; end=raw.find('"',start)
    data=base64.b64decode(raw[start:end])
    open(out,'wb').write(data)
    print('wrote', out, len(data))
