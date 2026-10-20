import base64
src=r'C:\Users\A\AppData\Local\Temp\dsh-spill-Kh3d8Y\session-35f4548edd54\2dcc560d87c6-mcp__rea__capture_browser_scenario.txt'
out=r'G:\sh\local-earth\docs\testdata\wind3d-closeup-hires.png'
raw=open(src,encoding='utf-8',errors='replace').read()
i=raw.find('"data_base64":"'); start=i+15; end=raw.find('"',start)
data=base64.b64decode(raw[start:end]); open(out,'wb').write(data)
print('wrote', out, len(data))
