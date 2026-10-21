p=r'G:\sh\local-earth\packaging\MaoMaoEarthLauncher.cs'
c=open(p,encoding='utf-8').read()
c=c.replace('using System.Net.Sockets;\nusing System.Collections.Generic;','using System.Net.Sockets;\nusing System.IO.Compression;\nusing System.Collections.Generic;',1)
c=c.replace('''        int port = 8123;
        bool noBrowser = false;
        string windDir = null;''','''        int port = 8123;
        bool noBrowser = false;
        string windDir = null;
        string crsOverride = null;''',1)
c=c.replace('''            if (a == "--no-browser") { noBrowser = true; continue; }
            if (a == "--cli") { if (command == "") command = "serve"; continue; }''','''            if (a == "--no-browser") { noBrowser = true; continue; }
            if (a == "--crs" && i + 1 < args.Length) { crsOverride = args[++i]; continue; }
            if (a == "--cli") { if (command == "") command = "serve"; continue; }''',1)
c=c.replace('return OpenMbtiles(windDir, port, noBrowser);','return OpenMbtiles(windDir, port, noBrowser, crsOverride);',1)
c=c.replace('static int OpenMbtiles(string file, int port, bool noBrowser)','static int OpenMbtiles(string file, int port, bool noBrowser, string crsOverride)',1)
c=c.replace('server = new MbtilesServer(full);','server = new MbtilesServer(full, crsOverride);',1)
c=c.replace('''        Console.WriteLine("MBTiles 已挂载：" + full);''','''        Console.WriteLine("MBTiles 已挂载：" + full);
        Console.WriteLine("MBTILES_CRS=" + server.Crs);''',1)
# constructor and field
c=c.replace('''        readonly string dbPath;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);''','''        readonly string dbPath;
        readonly string crsOverride;
        readonly Dictionary<string, string> meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);''',1)
c=c.replace('public MbtilesServer(string path) { dbPath = path; }','''public MbtilesServer(string path, string crsOverrideIn)
        {
            dbPath = path;
            crsOverride = crsOverrideIn;
        }

        public string Crs { get { return MetaValue("crs", "EPSG:3857"); } }''',1)
# meta json crs after scheme
old='''            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "bounds", bounds, false);'''
new='''            JsonField(sb, "scheme", scheme, false);
            JsonField(sb, "crs", Crs, false);
            JsonField(sb, "tileformat", format, false);
            JsonField(sb, "bounds", bounds, false);'''
assert old in c
c=c.replace(old,new,1)
# meta crs default in FillMissingMeta
old2='''            bool needZoom = !meta.ContainsKey("minzoom") || !meta.ContainsKey("maxzoom");
            bool needBounds = !meta.ContainsKey("bounds");
            if (!needZoom && !needBounds) return;'''
new2='''            if (!string.IsNullOrEmpty(crsOverride))
            {
                string v = crsOverride.Trim();
                if (v.StartsWith("EPSG:", StringComparison.OrdinalIgnoreCase)) meta["crs"] = v;
                else meta["crs"] = "EPSG:" + v;
            }
            if (!meta.ContainsKey("crs") || string.IsNullOrEmpty(meta["crs"]))
            {
                meta["crs"] = "EPSG:3857";
            }
            bool needZoom = !meta.ContainsKey("minzoom") || !meta.ContainsKey("maxzoom");
            bool needBounds = !meta.ContainsKey("bounds");
            if (!needZoom && !needBounds) return;'''
assert old2 in c
c=c.replace(old2,new2,1)
# pbf tile handling
old3='''                byte[] data = QueryTile(z, x, row);
                if (data == null || data.Length == 0)
                {
                    Respond(ctx, 204, null, null);
                    return;
                }
                Respond(ctx, 200, SniffContentType(data), data);
                return;'''
new3='''                byte[] data = QueryTile(z, x, row);
                if (data == null || data.Length == 0)
                {
                    Respond(ctx, 204, null, null);
                    return;
                }
                string fmt = MetaValue("format", "png").ToLowerInvariant();
                if (fmt == "pbf" || fmt == "mvt")
                {
                    byte[] payload = GunzipIfNeeded(data);
                    if (payload == null || payload.Length == 0) { Respond(ctx, 204, null, null); return; }
                    Respond(ctx, 200, "application/x-protobuf", payload);
                    return;
                }
                Respond(ctx, 200, SniffContentType(data), data);
                return;'''
assert old3 in c
c=c.replace(old3,new3,1)
# add GunzipIfNeeded before SniffContentType
old4='''        static string SniffContentType(byte[] d)'''
new4='''        static byte[] GunzipIfNeeded(byte[] data)
        {
            if (data == null || data.Length < 2 || data[0] != 0x1F || data[1] != 0x8B) return data;
            try
            {
                using (MemoryStream input = new MemoryStream(data))
                using (GZipStream gz = new GZipStream(input, CompressionMode.Decompress))
                using (MemoryStream output = new MemoryStream())
                {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = gz.Read(buf, 0, buf.Length)) > 0) output.Write(buf, 0, n);
                    return output.ToArray();
                }
            }
            catch { return data; }
        }

        static string SniffContentType(byte[] d)'''
assert old4 in c
c=c.replace(old4,new4,1)
open(p,'w',encoding='utf-8',newline='').write(c)
print('C# 4326/pbf patched')
