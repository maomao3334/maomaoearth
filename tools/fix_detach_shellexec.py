p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
# child token file
c=c.replace('''        string token = Environment.GetEnvironmentVariable("MAOMAO_MBTILES_TOKEN");
        try
        {
            MbtilesServer server = new MbtilesServer(file, token);''','''        string token = Environment.GetEnvironmentVariable("MAOMAO_MBTILES_TOKEN");
        string tokenFile = statePath + ".tok";
        if (File.Exists(tokenFile))
        {
            try { token = File.ReadAllText(tokenFile).Trim(); File.Delete(tokenFile); } catch { }
        }
        try
        {
            MbtilesServer server = new MbtilesServer(file, token);''',1)
# parent start: write tok, shell execute hidden
old='''        try { File.Delete(statePath); } catch { }
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = Process.GetCurrentProcess().MainModule.FileName;
        psi.Arguments = "__mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.EnvironmentVariables["MAOMAO_MBTILES_TOKEN"] = token;
        Process child = Process.Start(psi);'''
new='''        try { File.Delete(statePath); } catch { }
        string tokenFile = statePath + ".tok";
        File.WriteAllText(tokenFile, token, new UTF8Encoding(false));
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = Process.GetCurrentProcess().MainModule.FileName;
        psi.Arguments = "__mbtiles-server \\"" + full + "\\" \\"" + statePath + "\\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        Process child = Process.Start(psi);'''
if old not in c:
    print('parent pattern miss')
else:
    c=c.replace(old,new,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('detach patched')
