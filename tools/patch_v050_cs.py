p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
# version
c=c.replace('const string Version = "0.4.0";','const string Version = "0.5.0";',1)
# extra arg
c=c.replace('''        bool noBrowser = false;
        string windDir = null;''','''        bool noBrowser = false;
        string windDir = null;
        string extraArg = null;''',1)
c=c.replace('''            else if (windDir == null) windDir = a;''','''            else if (windDir == null) windDir = a;
            else if (extraArg == null) extraArg = a;''',1)
# switch case
c=c.replace('''                case "mbtiles":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("mbtiles 需要 .mbtiles 文件参数"); return 2; }
                    return OpenMbtiles(windDir, port, noBrowser);''','''                case "mbtiles":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("mbtiles 需要 .mbtiles 文件参数"); return 2; }
                    return OpenMbtiles(windDir, port, noBrowser);
                case "__mbtiles-server":
                    return RunMbtilesChild(windDir, extraArg);''',1)
# help
c=c.replace('''        Console.WriteLine("  MaoMaoEarth.exe mbtiles <文件>        启动 MBTiles 瓦片服务并打开应用");
        Console.WriteLine("    --port 8123 --no-browser             可选：静态服务端口 / 不自动打开浏览器");''','''        Console.WriteLine("  MaoMaoEarth.exe mbtiles <文件>        后台启动 MBTiles 瓦片服务并打开应用");
        Console.WriteLine("    --port 8123 --no-browser             可选：静态服务端口 / 不自动打开浏览器");
        Console.WriteLine("  MaoMaoEarth.exe stop                  停止静态服务与后台 MBTiles 服务");''',1)
# replace OpenMbtiles method
start=c.find('    static int OpenMbtiles(')
end=c.find('    /// <summary>本地 MBTiles', start)
assert start>0 and end>start
new_method=r'''    static string MbtilesStatePath
    {
        get { return Path.Combine(appDir, ".maomaoearth-mbtiles.state"); }
    }

    static Dictionary<string, string> ReadState(string path)
    {
        Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(path)) return d;
        try
        {
            foreach (string line in File.ReadAllLines(path))
            {
                int i = line.IndexOf('=');
                if (i > 0) d[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
            }
        }
        catch { }
        return d;
    }

    static bool MbtilesHealth(int port, string token)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health?token=" + Uri.EscapeDataString(token));
            req.Method = "GET"; req.Timeout = 1200; req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) return (int)res.StatusCode == 200;
        }
        catch { return false; }
    }

    static void StopMbtilesService(bool verbose)
    {
        string path = MbtilesStatePath;
        if (!File.Exists(path)) return;
        Dictionary<string, string> st = ReadState(path);
        int pid;
        if (st.TryGetValue("pid", out string pidText) && int.TryParse(pidText, out pid))
        {
            try
            {
                Process p = Process.GetProcessById(pid);
                p.Kill(); p.WaitForExit(2000);
                if (verbose) Console.WriteLine("已停止后台 MBTiles 服务 PID " + pid);
            }
            catch { }
        }
        try { File.Delete(path); } catch { }
    }

    static int RunMbtilesChild(string file, string statePath)
    {
        if (string.IsNullOrEmpty(file) || string.IsNullOrEmpty(statePath))
        {
            Console.Error.WriteLine("__mbtiles-server 参数不完整");
            return 2;
        }
        string token = Environment.GetEnvironmentVariable("MAOMAO_MBTILES_TOKEN");
        try
        {
            MbtilesServer server = new MbtilesServer(file, token);
            server.Start();
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("pid=" + Process.GetCurrentProcess().Id);
            sb.AppendLine("port=" + server.Port);
            sb.AppendLine("token=" + server.Token);
            sb.AppendLine("file=" + file);
            File.WriteAllText(statePath, sb.ToString(), new UTF8Encoding(false));
            while (true) Thread.Sleep(1000);
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(statePath, "error=" + ex.Message + Environment.NewLine, new UTF8Encoding(false)); } catch { }
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    static int OpenMbtiles(string file, int port, bool noBrowser)
    {
        if (!File.Exists(file)) { Console.Error.WriteLine("MBTiles 文件不存在：" + file); return 1; }
        string full = Path.GetFullPath(file);
        byte[] head = new byte[16];
        try
        {
            using (FileStream fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                if (fs.Read(head, 0, 16) != 16) { Console.Error.WriteLine("文件过小，不是 MBTiles"); return 1; }
            }
        }
        catch (Exception ex) { Console.Error.WriteLine("读取 MBTiles 失败：" + ex.Message); return 1; }
        if (!Encoding.ASCII.GetString(head).StartsWith("SQLite format 3"))
        {
            Console.Error.WriteLine("不是 SQLite/MBTiles 文件（缺少 SQLite 文件头）");
            return 1;
        }
        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        StopMbtilesService(false);
        string token = Guid.NewGuid().ToString("N");
        string statePath = MbtilesStatePath;
        try { File.Delete(statePath); } catch { }
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = Process.GetCurrentProcess().MainModule.FileName;
        psi.Arguments = "__mbtiles-server \"" + full + "\" \"" + statePath + "\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.EnvironmentVariables["MAOMAO_MBTILES_TOKEN"] = token;
        Process child = Process.Start(psi);
        int tilePort = 0;
        string childError = null;
        for (int i = 0; i < 100; i++)
        {
            Thread.Sleep(100);
            if (!File.Exists(statePath)) continue;
            Dictionary<string, string> st = ReadState(statePath);
            string err;
            if (st.TryGetValue("error", out err)) { childError = err; break; }
            string pText;
            if (st.TryGetValue("port", out pText) && int.TryParse(pText, out tilePort) && MbtilesHealth(tilePort, token)) break;
        }
        if (tilePort == 0)
        {
            Console.Error.WriteLine("后台 MBTiles 服务启动失败" + (childError != null ? "：" + childError : "（超时）"));
            try { if (child != null && !child.HasExited) child.Kill(); } catch { }
            try { File.Delete(statePath); } catch { }
            return 1;
        }
        string appUrl = "http://127.0.0.1:" + port + "/?mbtiles=" + Uri.EscapeDataString("http://127.0.0.1:" + tilePort) + "&mbtoken=" + Uri.EscapeDataString(token);
        Console.WriteLine("MBTiles 已挂载：" + full);
        Console.WriteLine("MBTiles 后台服务：" + "http://127.0.0.1:" + tilePort + "（PID " + child.Id + "）");
        Console.WriteLine("MBTILES_SERVER=http://127.0.0.1:" + tilePort);
        Console.WriteLine("MBTILES_TOKEN=" + token);
        Console.WriteLine("MBTILES_META=http://127.0.0.1:" + tilePort + "/meta.json?token=" + token);
        Console.WriteLine("MBTILES_APP=" + appUrl);
        Console.WriteLine("停止：MaoMaoEarth.exe stop");
        if (!noBrowser) OpenBrowserUrl(appUrl);
        else Console.WriteLine("打开：" + appUrl);
        return 0;
    }

'''
c=c[:start]+new_method+c[end:]
# StopServer: stop mbtiles first
c=c.replace('''    static int StopServer()
    {
        if (!File.Exists(pidPath)) { Console.WriteLine("没有记录的服务 PID（可能未由本启动器启动）"); return 0; }''','''    static int StopServer()
    {
        StopMbtilesService(true);
        if (!File.Exists(pidPath)) { Console.WriteLine("没有记录的静态服务 PID（可能未由本启动器启动）"); return 0; }''',1)
# MbtilesServer constructor/token
c=c.replace('''        readonly string dbPath;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);''','''        readonly string dbPath;
        readonly string forcedToken;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);''',1)
c=c.replace('''        public MbtilesServer(string path) { dbPath = path; }''','''        public MbtilesServer(string path, string token) { dbPath = path; forcedToken = token; }''',1)
c=c.replace('''            Token = Guid.NewGuid().ToString("N");''','''            Token = string.IsNullOrEmpty(forcedToken) ? Guid.NewGuid().ToString("N") : forcedToken;''',1)
# add crs to meta json
c=c.replace('''            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "bounds", bounds, false);''','''            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "crs", MetaValue("crs", MetaValue("projection", "EPSG:3857")), false);
            JsonField(sb, "bounds", bounds, false);''',1)
# content type pbf
c=c.replace('''                Respond(ctx, 200, SniffContentType(data), data);''','''                string fmt = MetaValue("format", "").ToLowerInvariant();
                string ct = (fmt == "pbf" || fmt == "mvt") ? "application/x-protobuf" : SniffContentType(data);
                Respond(ctx, 200, ct, data);''',1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('C# v0.5 patched', len(c))
