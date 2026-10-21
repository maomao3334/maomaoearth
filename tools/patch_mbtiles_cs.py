p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('using System.Net.Sockets;\nusing System.Text;','using System.Net.Sockets;\nusing System.Collections.Generic;\nusing System.Runtime.InteropServices;\nusing System.Text;',1)
c=c.replace('//   MaoMaoEarth.exe windninja <dir> 启动服务并打开指定 WindNinja 结果目录','//   MaoMaoEarth.exe windninja <dir> 启动服务并打开指定 WindNinja 结果目录\n//   MaoMaoEarth.exe mbtiles <file> 启动本地 MBTiles 瓦片服务并打开应用',1)
c=c.replace('''                case "windninja":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("windninja 需要目录参数"); return 2; }
                    return OpenWindDir(windDir, port, noBrowser);''','''                case "windninja":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("windninja 需要目录参数"); return 2; }
                    return OpenWindDir(windDir, port, noBrowser);
                case "mbtiles":
                    if (string.IsNullOrEmpty(windDir)) { Console.Error.WriteLine("mbtiles 需要 .mbtiles 文件参数"); return 2; }
                    return OpenMbtiles(windDir, port, noBrowser);''',1)
c=c.replace('''        Console.WriteLine("  MaoMaoEarth.exe windninja <目录>      启动并打开 WindNinja 结果目录");''','''        Console.WriteLine("  MaoMaoEarth.exe windninja <目录>      启动并打开 WindNinja 结果目录");
        Console.WriteLine("  MaoMaoEarth.exe mbtiles <文件>        启动 MBTiles 瓦片服务并打开应用");
        Console.WriteLine("    --port 8123 --no-browser             可选：静态服务端口 / 不自动打开浏览器");''',1)
marker='    static int OpenWindDir(string dir, int port, bool noBrowser)'
idx=c.find(marker)
assert idx>0, 'anchor not found'
addition=r'''
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
        string magic = Encoding.ASCII.GetString(head);
        if (!magic.StartsWith("SQLite format 3"))
        {
            Console.Error.WriteLine("不是 SQLite/MBTiles 文件（缺少 SQLite 文件头）");
            return 1;
        }
        int rc = EnsureServer(ref port);
        if (rc != 0) return rc;
        MbtilesServer server = null;
        try
        {
            server = new MbtilesServer(full);
            server.Start();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("MBTiles 服务启动失败：" + ex.Message);
            return 1;
        }
        string appUrl = "http://127.0.0.1:" + port + "/?mbtiles=" + Uri.EscapeDataString(server.BaseUrl) + "&mbtoken=" + Uri.EscapeDataString(server.Token);
        Console.WriteLine("MBTiles 已挂载：" + full);
        Console.WriteLine("MBTILES_SERVER=" + server.BaseUrl);
        Console.WriteLine("MBTILES_TOKEN=" + server.Token);
        Console.WriteLine("MBTILES_META=" + server.BaseUrl + "/meta.json?token=" + server.Token);
        Console.WriteLine("MBTILES_APP=" + appUrl);
        if (!noBrowser) OpenBrowserUrl(appUrl);
        else Console.WriteLine("打开：" + appUrl);
        Console.WriteLine("按 Ctrl+C 停止 MBTiles 瓦片服务（静态服务保持运行）。");
        while (true) Thread.Sleep(500);
    }

    /// <summary>本地 MBTiles(SQLite) 瓦片服务：只监听 127.0.0.1，token 校验，按 z/x/y 查询。</summary>
    class MbtilesServer
    {
        const int SQLITE_OK = 0;
        const int SQLITE_ROW = 100;
        const int SQLITE_OPEN_READONLY = 1;

        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_bind_int(IntPtr stmt, int index, int value);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_step(IntPtr stmt);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_column_blob(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_column_bytes(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_column_int(IntPtr stmt, int col);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_finalize(IntPtr stmt);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int sqlite3_close(IntPtr db);
        [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr sqlite3_errmsg(IntPtr db);

        public string BaseUrl { get; private set; }
        public string Token { get; private set; }
        public string MetaJson { get; private set; }
        public int Port { get; private set; }

        readonly string dbPath;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        HttpListener listener;
        Thread thread;
        volatile bool running;

        public MbtilesServer(string path) { dbPath = path; }

        public void Start()
        {
            ReadMetadata();
            FillMissingMeta();
            int p = MaoMaoEarthLauncher.FreePort(8140);
            if (p < 0) throw new Exception("找不到可用的 MBTiles 服务端口");
            listener = new HttpListener();
            while (true)
            {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + p + "/");
                try { listener.Start(); break; }
                catch
                {
                    try { listener.Close(); } catch { }
                    p = MaoMaoEarthLauncher.FreePort(p + 1);
                    if (p < 0) throw new Exception("无法绑定 MBTiles 服务端口");
                }
            }
            Port = p;
            Token = Guid.NewGuid().ToString("N");
            BaseUrl = "http://127.0.0.1:" + Port;
            MetaJson = BuildMetaJson();
            running = true;
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Start();
        }

        void Loop()
        {
            while (running && listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { if (!running) break; continue; }
                try { Handle(ctx); }
                catch (Exception ex)
                {
                    try { Respond(ctx, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("500 " + ex.Message)); } catch { }
                }
            }
        }

        void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            if (req.HttpMethod == "OPTIONS")
            {
                Respond(ctx, 204, null, null);
                return;
            }
            string token = req.QueryString["token"];
            if (string.IsNullOrEmpty(token) || token != Token)
            {
                Respond(ctx, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("403 invalid token"));
                return;
            }
            string path = req.Url.AbsolutePath;
            if (path == "/meta.json")
            {
                Respond(ctx, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(MetaJson));
                return;
            }
            if (path == "/health")
            {
                Respond(ctx, 200, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                return;
            }
            if (path.StartsWith("/tiles/", StringComparison.OrdinalIgnoreCase))
            {
                string rest = path.Substring("/tiles/".Length).Trim('/');
                string[] parts = rest.Split('/');
                if (parts.Length != 3)
                {
                    Respond(ctx, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("400 expected /tiles/z/x/y.ext"));
                    return;
                }
                int z, x, y;
                if (!int.TryParse(parts[0], out z) || !int.TryParse(parts[1], out x)) { Respond(ctx, 400, null, null); return; }
                string yText = parts[2];
                int dot = yText.IndexOf('.');
                if (dot >= 0) yText = yText.Substring(0, dot);
                if (!int.TryParse(yText, out y)) { Respond(ctx, 400, null, null); return; }
                if (z < 0 || z > 30) { Respond(ctx, 400, null, null); return; }
                int row = y;
                if (!IsXyzScheme()) row = (1 << z) - 1 - y;
                byte[] data = QueryTile(z, x, row);
                if (data == null || data.Length == 0)
                {
                    Respond(ctx, 204, null, null);
                    return;
                }
                Respond(ctx, 200, SniffContentType(data), data);
                return;
            }
            Respond(ctx, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("404"));
        }

        bool IsXyzScheme()
        {
            string v;
            if (meta.TryGetValue("scheme", out v) && v != null && v.Trim().Equals("xyz", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        void Respond(HttpListenerContext ctx, int status, string contentType, byte[] body)
        {
            HttpListenerResponse res = ctx.Response;
            res.StatusCode = status;
            res.Headers["Access-Control-Allow-Origin"] = "*";
            res.Headers["Access-Control-Allow-Headers"] = "*";
            res.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
            res.Headers["X-Content-Type-Options"] = "nosniff";
            res.Headers["Cache-Control"] = status == 200 ? "public, max-age=86400" : "no-store";
            if (contentType != null) res.ContentType = contentType;
            if (body != null && body.Length > 0)
            {
                res.ContentLength64 = body.Length;
                res.OutputStream.Write(body, 0, body.Length);
            }
            else
            {
                res.ContentLength64 = 0;
            }
            res.OutputStream.Close();
        }

        static byte[] Utf8(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }

        static int OpenDb(string path, out IntPtr db)
        {
            return sqlite3_open_v2(Utf8(path), out db, SQLITE_OPEN_READONLY, IntPtr.Zero);
        }

        static string ColumnText(IntPtr stmt, int col)
        {
            IntPtr p = sqlite3_column_text(stmt, col);
            int n = sqlite3_column_bytes(stmt, col);
            if (p == IntPtr.Zero || n <= 0) return "";
            byte[] b = new byte[n];
            Marshal.Copy(p, b, 0, n);
            return Encoding.UTF8.GetString(b);
        }

        void ReadMetadata()
        {
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) throw new Exception("无法打开 MBTiles（winsqlite3）");
            try
            {
                IntPtr stmt;
                if (sqlite3_prepare_v2(db, Utf8("SELECT name,value FROM metadata"), -1, out stmt, IntPtr.Zero) == SQLITE_OK)
                {
                    try
                    {
                        while (sqlite3_step(stmt) == SQLITE_ROW)
                        {
                            string k = ColumnText(stmt, 0);
                            string v = ColumnText(stmt, 1);
                            if (!string.IsNullOrEmpty(k)) meta[k] = v;
                        }
                    }
                    finally { sqlite3_finalize(stmt); }
                }
            }
            finally { sqlite3_close(db); }
        }

        void FillMissingMeta()
        {
            bool needZoom = !meta.ContainsKey("minzoom") || !meta.ContainsKey("maxzoom");
            bool needBounds = !meta.ContainsKey("bounds");
            if (!needZoom && !needBounds) return;
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) return;
            try
            {
                if (needZoom)
                {
                    IntPtr stmt;
                    if (sqlite3_prepare_v2(db, Utf8("SELECT MIN(zoom_level),MAX(zoom_level),COUNT(*) FROM tiles"), -1, out stmt, IntPtr.Zero) == SQLITE_OK)
                    {
                        try
                        {
                            if (sqlite3_step(stmt) == SQLITE_ROW)
                            {
                                int minz = sqlite3_column_int(stmt, 0);
                                int maxz = sqlite3_column_int(stmt, 1);
                                int count = sqlite3_column_int(stmt, 2);
                                if (count <= 0) throw new Exception("MBTiles tiles 表为空");
                                if (!meta.ContainsKey("minzoom")) meta["minzoom"] = minz.ToString();
                                if (!meta.ContainsKey("maxzoom")) meta["maxzoom"] = maxz.ToString();
                            }
                        }
                        finally { sqlite3_finalize(stmt); }
                    }
                }
                if (needBounds) meta["bounds"] = "-180,-85,180,85";
            }
            finally { sqlite3_close(db); }
        }

        byte[] QueryTile(int z, int x, int row)
        {
            IntPtr db;
            if (OpenDb(dbPath, out db) != SQLITE_OK) return null;
            IntPtr stmt = IntPtr.Zero;
            try
            {
                string sql = "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1";
                if (sqlite3_prepare_v2(db, Utf8(sql), -1, out stmt, IntPtr.Zero) != SQLITE_OK) return null;
                sqlite3_bind_int(stmt, 1, z);
                sqlite3_bind_int(stmt, 2, x);
                sqlite3_bind_int(stmt, 3, row);
                if (sqlite3_step(stmt) != SQLITE_ROW) return null;
                IntPtr p = sqlite3_column_blob(stmt, 0);
                int n = sqlite3_column_bytes(stmt, 0);
                if (p == IntPtr.Zero || n <= 0) return null;
                byte[] data = new byte[n];
                Marshal.Copy(p, data, 0, n);
                return data;
            }
            finally
            {
                if (stmt != IntPtr.Zero) sqlite3_finalize(stmt);
                sqlite3_close(db);
            }
        }

        string MetaValue(string key, string def)
        {
            string v;
            return meta.TryGetValue(key, out v) && !string.IsNullOrEmpty(v) ? v : def;
        }

        string BuildMetaJson()
        {
            string format = MetaValue("format", "png").ToLowerInvariant();
            if (format == "jpeg") format = "jpg";
            string scheme = IsXyzScheme() ? "xyz" : "tms";
            string bounds = MetaValue("bounds", "-180,-85,180,85");
            string minzoom = MetaValue("minzoom", "0");
            string maxzoom = MetaValue("maxzoom", "22");
            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            JsonField(sb, "name", MetaValue("name", Path.GetFileNameWithoutExtension(dbPath)), true);
            JsonField(sb, "format", format, false);
            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "bounds", bounds, false);
            JsonNumber(sb, "minzoom", minzoom);
            JsonNumber(sb, "maxzoom", maxzoom);
            JsonField(sb, "attribution", MetaValue("attribution", "MBTiles"), false);
            JsonField(sb, "description", MetaValue("description", ""), false);
            sb.Append("}");
            return sb.ToString();
        }

        static void JsonField(StringBuilder sb, string key, string val, bool first)
        {
            if (!first) sb.Append(",");
            sb.Append("\"").Append(key).Append("\":\"").Append(JsonEscape(val)).Append("\"");
        }
        static void JsonNumber(StringBuilder sb, string key, string val)
        {
            int n;
            if (!int.TryParse(val, out n)) n = 0;
            sb.Append(",\"").Append(key).Append("\":").Append(n);
        }
        static string JsonEscape(string s)
        {
            if (s == null) return "";
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                char ch = s[i];
                switch (ch)
                {
                    case '\\': b.Append("\\\\"); break;
                    case '"': b.Append("\\\""); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default: if (ch < 32) b.Append("\\u").Append(((int)ch).ToString("x4")); else b.Append(ch); break;
                }
            }
            return b.ToString();
        }

        static string SniffContentType(byte[] d)
        {
            if (d.Length >= 8 && d[0] == 0x89 && d[1] == 0x50 && d[2] == 0x4E && d[3] == 0x47) return "image/png";
            if (d.Length >= 3 && d[0] == 0xFF && d[1] == 0xD8) return "image/jpeg";
            if (d.Length >= 12 && d[0] == 'R' && d[1] == 'I' && d[2] == 'F' && d[3] == 'F' && d[8] == 'W' && d[9] == 'E' && d[10] == 'B' && d[11] == 'P') return "image/webp";
            if (d.Length >= 6 && d[0] == 'G' && d[1] == 'I' && d[2] == 'F') return "image/gif";
            return "application/octet-stream";
        }
    }

'''
c=c[:idx]+addition+c[idx:]
open(p,'w',encoding='utf-8',newline='').write(c)
print('C# patched, size',len(c))
