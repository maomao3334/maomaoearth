content = """# runtime
.maomaoearth.pid
maomaoearth.log

# OS/editor
Thumbs.db
desktop.ini
.DS_Store
*.swp
.vscode/
.idea/

# temp/test output
tools/*.log
docs/testdata/*.log
*.tmp
*.bak

# dependencies/build cache
node_modules/
dist/

# large generated offline data (distributed via GitHub Release data pack; see README)
data/public/dem/*.bin
data/public/dem/*.hgt.gz
data/public/dem/*.png
data/public/imagery/s2cloudless/
data/public/imagery/blue-marble-21600.jpg
data/public/tiles/
docs/testdata/
release/
"""
open(r'G:\sh\local-earth\.gitignore','w',encoding='utf-8',newline='\n').write(content)
print('gitignore rewritten')
