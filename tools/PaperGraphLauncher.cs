using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class PaperGraphLauncher
{
    private const string MutexName = "Local\\PaperKnowledgeGraphOpenSourceLauncherV1";
    private static readonly string StateDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PaperKnowledgeGraphOpenSource");
    private static readonly string PortFile = Path.Combine(StateDir, "port.txt");

    [STAThread]
    private static void Main()
    {
        bool ownsMutex;
        using (var mutex = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                OpenExisting();
                return;
            }

            try
            {
                string siteRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist");
                string libraryRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "library");
                if (!File.Exists(Path.Combine(siteRoot, "index.html")))
                    throw new FileNotFoundException("找不到 dist\\index.html。请保持 EXE 与 dist 文件夹位于同一目录。 ");
                string catalogPath = Path.Combine(siteRoot, "papers.json");
                string exampleCatalogPath = Path.Combine(siteRoot, "papers.example.json");
                if (!File.Exists(catalogPath))
                {
                    if (!File.Exists(exampleCatalogPath))
                        throw new FileNotFoundException("找不到 dist\\papers.example.json。");
                    File.Copy(exampleCatalogPath, catalogPath);
                }

                Directory.CreateDirectory(StateDir);
                Directory.CreateDirectory(libraryRoot);
                int port = FindPort(8765);
                File.WriteAllText(PortFile, port.ToString(), Encoding.ASCII);
                string url = "http://127.0.0.1:" + port + "/";

                var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                try { OpenUrl(url); }
                catch { }

                while (true)
                {
                    TcpClient client = listener.AcceptTcpClient();
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        using (client)
                        {
                            try { Serve(client, siteRoot, libraryRoot); }
                            catch { }
                        }
                    });
                }
            }
            catch (Exception ex)
            {
                try
                {
                    Directory.CreateDirectory(StateDir);
                    File.WriteAllText(Path.Combine(StateDir, "last-error.txt"), ex.ToString(), Encoding.UTF8);
                }
                catch { }
                MessageBox.Show(ex.Message, "论文知识图谱启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                try { if (File.Exists(PortFile)) File.Delete(PortFile); } catch { }
            }
        }
    }

    private static void OpenExisting()
    {
        try
        {
            int port;
            if (File.Exists(PortFile) && int.TryParse(File.ReadAllText(PortFile), out port))
                OpenUrl("http://127.0.0.1:" + port + "/");
        }
        catch { }
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private static int FindPort(int start)
    {
        for (int port = start; port < start + 100; port++)
        {
            try
            {
                var probe = new TcpListener(IPAddress.Loopback, port);
                probe.Start();
                probe.Stop();
                return port;
            }
            catch (SocketException) { }
        }
        throw new InvalidOperationException("找不到可用的本地端口。");
    }

    private static void Serve(TcpClient client, string siteRoot, string libraryRoot)
    {
        NetworkStream stream = client.GetStream();
        var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
        string request = reader.ReadLine();
        string line;
        int contentLength = 0;
        while (!string.IsNullOrEmpty(line = reader.ReadLine()))
        {
            if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                int.TryParse(line.Substring("Content-Length:".Length).Trim(), out contentLength);
        }

        string requestTarget = "/";
        if (!string.IsNullOrEmpty(request))
        {
            string[] parts = request.Split(' ');
            if (parts.Length > 1) requestTarget = parts[1];
        }
        string requestPath = requestTarget.Split('?')[0];
        if (requestPath == "/") requestPath = "/index.html";

        if (string.Equals(requestPath, "/rename-paper", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                if (contentLength <= 0 || contentLength > 64 * 1024) throw new InvalidOperationException("标题请求为空或过长。");
                string formBody = ReadRequestBody(reader, contentLength);
                Dictionary<string, string> form = ParseForm(formBody);
                Paper updated = RenamePaper(siteRoot, libraryRoot, GetFormValue(form, "id"), GetFormValue(form, "path"), GetFormValue(form, "title"));
                string json = new JavaScriptSerializer().Serialize(updated);
                WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
            }
            catch (Exception ex)
            {
                WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message));
            }
            return;
        }

        if (string.Equals(requestPath, "/upload-image", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                if (contentLength <= 0 || contentLength > 14 * 1024 * 1024) throw new InvalidOperationException("图片数据为空或超过 10 MB 限制。");
                string dataUrl = ReadRequestBody(reader, contentLength);
                string imageUrl = SaveImage(siteRoot, dataUrl);
                string json = new JavaScriptSerializer().Serialize(new { url = imageUrl });
                WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
            }
            catch (Exception ex)
            {
                WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message));
            }
            return;
        }

        if (string.Equals(requestPath, "/refresh-catalog", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                CatalogRefreshResult result = RefreshCatalog(siteRoot, libraryRoot);
                string json = new JavaScriptSerializer().Serialize(result);
                WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
            }
            catch (Exception ex)
            {
                WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message));
            }
            return;
        }

        bool pdfRequest = requestTarget.StartsWith("/pdf?path=", StringComparison.OrdinalIgnoreCase);
        bool openPdfRequest = requestTarget.StartsWith("/open-pdf?path=", StringComparison.OrdinalIgnoreCase);
        bool localPdfRequest = pdfRequest || openPdfRequest;
        string fullPath;
        string rootPath;
        if (localPdfRequest)
        {
            string prefix = openPdfRequest ? "/open-pdf?path=" : "/pdf?path=";
            string encodedPath = requestTarget.Substring(prefix.Length);
            fullPath = Path.GetFullPath(Uri.UnescapeDataString(encodedPath));
            rootPath = Path.GetFullPath(libraryRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        }
        else
        {
            string relative = Uri.UnescapeDataString(requestPath.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
            fullPath = Path.GetFullPath(Path.Combine(siteRoot, relative));
            rootPath = Path.GetFullPath(siteRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        }

        byte[] body;
        string status;
        string contentType;
        if (!fullPath.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath) || (localPdfRequest && !string.Equals(Path.GetExtension(fullPath), ".pdf", StringComparison.OrdinalIgnoreCase)))
        {
            status = "404 Not Found";
            contentType = "text/plain; charset=utf-8";
            body = Encoding.UTF8.GetBytes("404 Not Found");
        }
        else if (openPdfRequest)
        {
            try
            {
                Process.Start(new ProcessStartInfo(fullPath) { UseShellExecute = true });
                status = "200 OK";
                contentType = "text/plain; charset=utf-8";
                body = Encoding.UTF8.GetBytes("OPENED");
            }
            catch (Exception ex)
            {
                status = "500 Internal Server Error";
                contentType = "text/plain; charset=utf-8";
                body = Encoding.UTF8.GetBytes(ex.Message);
            }
        }
        else
        {
            status = "200 OK";
            contentType = pdfRequest ? "application/pdf" : ContentType(fullPath);
            body = File.ReadAllBytes(fullPath);
        }

        WriteResponse(stream, status, contentType, body);
    }

    private static string ReadRequestBody(StreamReader reader, int contentLength)
    {
        char[] buffer = new char[contentLength];
        int totalRead = 0;
        while (totalRead < buffer.Length)
        {
            int count = reader.Read(buffer, totalRead, buffer.Length - totalRead);
            if (count <= 0) break;
            totalRead += count;
        }
        return new string(buffer, 0, totalRead);
    }

    private static Dictionary<string, string> ParseForm(string body)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string pair in (body ?? "").Split('&'))
        {
            string[] parts = pair.Split(new[] { '=' }, 2);
            if (parts.Length == 0 || parts[0].Length == 0) continue;
            string key = Uri.UnescapeDataString(parts[0].Replace("+", " "));
            string value = parts.Length > 1 ? Uri.UnescapeDataString(parts[1].Replace("+", " ")) : "";
            result[key] = value;
        }
        return result;
    }

    private static string GetFormValue(Dictionary<string, string> form, string key)
    {
        string value;
        return form.TryGetValue(key, out value) ? value : "";
    }

    private static void WriteResponse(NetworkStream stream, string status, string contentType, byte[] body)
    {
        string header = "HTTP/1.1 " + status + "\r\n" +
                        "Content-Type: " + contentType + "\r\n" +
                        "Content-Length: " + body.Length + "\r\n" +
                        "Cache-Control: no-cache\r\nConnection: close\r\n\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static CatalogRefreshResult RefreshCatalog(string siteRoot, string libraryRoot)
    {
        string catalogPath = Path.Combine(siteRoot, "papers.json");
        var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        Catalog catalog = serializer.Deserialize<Catalog>(File.ReadAllText(catalogPath, Encoding.UTF8)) ?? new Catalog();
        if (catalog.papers == null) catalog.papers = new List<Paper>();

        var knownPaths = new HashSet<string>(catalog.papers.Where(p => !string.IsNullOrWhiteSpace(p.path)).Select(p => Path.GetFullPath(p.path)), StringComparer.OrdinalIgnoreCase);
        int nextId = catalog.papers.Select(p =>
        {
            Match match = Regex.Match(p.id ?? "", "^p(\\d+)$", RegexOptions.IgnoreCase);
            return match.Success ? int.Parse(match.Groups[1].Value) : 0;
        }).DefaultIfEmpty(0).Max() + 1;

        string[] files = Directory.GetFiles(libraryRoot, "*.pdf", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        int added = 0;
        int moved = 0;
        var unmatchedFiles = files.Where(path => !knownPaths.Contains(Path.GetFullPath(path))).ToList();
        foreach (Paper paper in catalog.papers.Where(p => !string.IsNullOrWhiteSpace(p.path) && !File.Exists(p.path)).ToList())
        {
            List<string> candidates = unmatchedFiles.Where(path => string.Equals(Path.GetFileName(path), paper.filename, StringComparison.OrdinalIgnoreCase)).ToList();
            if (candidates.Count != 1) continue;
            string updatedPath = Path.GetFullPath(candidates[0]);
            List<string> updatedTaxonomy = TaxonomyForPath(updatedPath, libraryRoot);
            paper.path = updatedPath;
            paper.taxonomy = updatedTaxonomy;
            paper.keywords = new List<string>(updatedTaxonomy);
            paper.sizeMB = Math.Round(new FileInfo(updatedPath).Length / 1024d / 1024d, 2);
            knownPaths.Add(updatedPath);
            unmatchedFiles.Remove(candidates[0]);
            moved++;
        }

        int removed = catalog.papers.RemoveAll(p => string.IsNullOrWhiteSpace(p.path) || !File.Exists(p.path));

        foreach (string path in unmatchedFiles)
        {
            string fullPath = Path.GetFullPath(path);
            if (knownPaths.Contains(fullPath)) continue;
            catalog.papers.Add(BuildPaper(fullPath, libraryRoot, nextId++));
            knownPaths.Add(fullPath);
            added++;
        }

        if (added > 0 || moved > 0 || removed > 0)
        {
            string temporary = catalogPath + ".tmp";
            File.WriteAllText(temporary, serializer.Serialize(catalog), new UTF8Encoding(false));
            try { File.Replace(temporary, catalogPath, null); }
            catch
            {
                File.Copy(temporary, catalogPath, true);
                File.Delete(temporary);
            }
        }
        return new CatalogRefreshResult { added = added, moved = moved, removed = removed, total = catalog.papers.Count };
    }

    private static Paper RenamePaper(string siteRoot, string libraryRoot, string id, string requestedPath, string requestedTitle)
    {
        string title = (requestedTitle ?? "").Trim().TrimEnd('.', ' ');
        if (title.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            title = title.Substring(0, title.Length - 4).Trim().TrimEnd('.', ' ');
        if (string.IsNullOrWhiteSpace(title)) throw new InvalidOperationException("标题不能为空。");
        if (title.Length > 180) throw new InvalidOperationException("标题过长，请控制在 180 个字符以内。");
        if (title.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidOperationException("标题包含 Windows 文件名不允许的字符：\\ / : * ? \" < > |");
        if (Regex.IsMatch(title, "^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", RegexOptions.IgnoreCase))
            throw new InvalidOperationException("该标题是 Windows 保留文件名，请换一个名称。");

        string catalogPath = Path.Combine(siteRoot, "papers.json");
        var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        Catalog catalog = serializer.Deserialize<Catalog>(File.ReadAllText(catalogPath, Encoding.UTF8)) ?? new Catalog();
        if (catalog.papers == null) catalog.papers = new List<Paper>();
        Paper paper = catalog.papers.FirstOrDefault(item => string.Equals(item.id, id, StringComparison.OrdinalIgnoreCase));
        if (paper == null) throw new FileNotFoundException("找不到对应的论文元数据，请先执行一键更新。");

        string oldPath = Path.GetFullPath(paper.path ?? requestedPath ?? "");
        string suppliedPath = Path.GetFullPath(requestedPath ?? "");
        if (!string.Equals(oldPath, suppliedPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("论文路径已变化，请先执行一键更新后重试。");
        string libraryPrefix = Path.GetFullPath(libraryRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!oldPath.StartsWith(libraryPrefix, StringComparison.OrdinalIgnoreCase) || !string.Equals(Path.GetExtension(oldPath), ".pdf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("只能重命名论文目录内的 PDF 文件。");
        if (!File.Exists(oldPath)) throw new FileNotFoundException("本地 PDF 已不存在，请先执行一键更新。");

        string newPath = Path.Combine(Path.GetDirectoryName(oldPath), title + ".pdf");
        if (newPath.Length >= 248) throw new PathTooLongException("新文件路径过长，请缩短标题。");
        bool samePath = string.Equals(oldPath, newPath, StringComparison.OrdinalIgnoreCase);
        if (!samePath && File.Exists(newPath)) throw new IOException("同一文件夹中已经存在同名 PDF，未执行覆盖。 ");

        string movedPath = oldPath;
        try
        {
            if (samePath && !string.Equals(oldPath, newPath, StringComparison.Ordinal))
            {
                string temporaryPath = Path.Combine(Path.GetDirectoryName(oldPath), ".paper-rename-" + Guid.NewGuid().ToString("N") + ".pdf");
                File.Move(oldPath, temporaryPath);
                File.Move(temporaryPath, newPath);
                movedPath = newPath;
            }
            else if (!samePath)
            {
                File.Move(oldPath, newPath);
                movedPath = newPath;
            }

            paper.title = title;
            paper.filename = Path.GetFileName(newPath);
            paper.path = newPath;
            Match yearMatch = Regex.Match(paper.filename, "\\b(20\\d{2}|19\\d{2})\\b");
            paper.year = yearMatch.Success ? yearMatch.Value : "未知";
            paper.venue = InferVenue(paper.filename);
            paper.sizeMB = Math.Round(new FileInfo(newPath).Length / 1024d / 1024d, 2);

            string temporaryCatalog = catalogPath + ".tmp";
            File.WriteAllText(temporaryCatalog, serializer.Serialize(catalog), new UTF8Encoding(false));
            try { File.Replace(temporaryCatalog, catalogPath, null); }
            catch
            {
                File.Copy(temporaryCatalog, catalogPath, true);
                File.Delete(temporaryCatalog);
            }
            return paper;
        }
        catch
        {
            try
            {
                if (!string.Equals(movedPath, oldPath, StringComparison.Ordinal) && File.Exists(movedPath) && !File.Exists(oldPath))
                    File.Move(movedPath, oldPath);
            }
            catch { }
            throw;
        }
    }

    private static string SaveImage(string siteRoot, string dataUrl)
    {
        Match match = Regex.Match(dataUrl ?? "", "^data:(image/(?:png|jpeg|gif|webp));base64,(.+)$", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        if (!match.Success) throw new InvalidOperationException("仅支持 PNG、JPEG、GIF 或 WebP 图片。");
        byte[] bytes = Convert.FromBase64String(match.Groups[2].Value);
        if (bytes.Length == 0 || bytes.Length > 10 * 1024 * 1024) throw new InvalidOperationException("图片数据为空或超过 10 MB 限制。");
        string mime = match.Groups[1].Value.ToLowerInvariant();
        string extension = mime == "image/jpeg" ? ".jpg" : "." + mime.Substring("image/".Length);
        string assetDirectory = Path.Combine(siteRoot, "user-assets");
        Directory.CreateDirectory(assetDirectory);
        string fileName = Guid.NewGuid().ToString("N") + extension;
        File.WriteAllBytes(Path.Combine(assetDirectory, fileName), bytes);
        return "/user-assets/" + fileName;
    }

    private static Paper BuildPaper(string path, string libraryRoot, int id)
    {
        string fileName = Path.GetFileName(path);
        string stem = Path.GetFileNameWithoutExtension(path);
        bool read = stem.Contains("✅") || stem.Contains("√") || stem.Contains("读完") || stem.Contains("概述");
        string title = Regex.Replace(stem, "^(?:✅️?\\s*|√\\s*|读完-)", "");
        title = Regex.Replace(title.Replace('_', ' '), "\\s+", " ").Trim(' ', '-');

        List<string> taxonomy = TaxonomyForPath(path, libraryRoot);
        Match yearMatch = Regex.Match(fileName, "\\b(20\\d{2}|19\\d{2})\\b");
        string summary = read ? EmbeddedSummary(stem) : "";
        if (read && string.IsNullOrWhiteSpace(summary)) summary = "已读；请在右侧补充或修改摘要。";

        return new Paper
        {
            id = "p" + id,
            title = title,
            filename = fileName,
            year = yearMatch.Success ? yearMatch.Value : "未知",
            venue = InferVenue(fileName),
            authors = "PDF 元数据未提供",
            taxonomy = taxonomy,
            keywords = new List<string>(taxonomy),
            read = read,
            summary = summary,
            path = path,
            sizeMB = Math.Round(new FileInfo(path).Length / 1024d / 1024d, 2)
        };
    }

    private static string MakeRelativeDirectory(string root, string directory)
    {
        Uri rootUri = new Uri(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar);
        Uri directoryUri = new Uri(directory.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar);
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(directoryUri).ToString()).Replace('/', Path.DirectorySeparatorChar).TrimEnd(Path.DirectorySeparatorChar);
    }

    private static List<string> TaxonomyForPath(string path, string libraryRoot)
    {
        string relativeDirectory = MakeRelativeDirectory(libraryRoot, Path.GetDirectoryName(path));
        return relativeDirectory.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries).Distinct().ToList();
    }

    private static string EmbeddedSummary(string stem)
    {
        int marker = stem.IndexOf("读完-", StringComparison.Ordinal);
        if (marker < 0) return "";
        string[] chunks = stem.Substring(marker + 3).Split('-');
        var chinese = chunks.Where(chunk => Regex.IsMatch(chunk, "[\\u4e00-\\u9fff]")).Select(chunk => chunk.Trim()).Where(chunk => chunk.Length > 0).ToList();
        return string.Join("；", chinese.ToArray());
    }

    private static string InferVenue(string text)
    {
        string[] venues = { "ACL", "NAACL", "EMNLP", "ICLR", "ICML", "NeurIPS", "CVPR", "ECCV", "COLM", "COLING", "AAAI", "SIGIR", "CIKM", "KDD", "TACL", "WACV", "ICASSP", "ACM MM", "TKDE", "TIP", "CSUR", "arXiv" };
        return venues.FirstOrDefault(venue => text.IndexOf(venue, StringComparison.OrdinalIgnoreCase) >= 0) ?? "未标注";
    }

    private static string ContentType(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".gif": return "image/gif";
            case ".webp": return "image/webp";
            default: return "application/octet-stream";
        }
    }

    public sealed class Catalog { public List<Paper> papers { get; set; } }
    public sealed class CatalogRefreshResult { public int added { get; set; } public int moved { get; set; } public int removed { get; set; } public int total { get; set; } }
    public sealed class Paper
    {
        public string id { get; set; }
        public string title { get; set; }
        public string filename { get; set; }
        public string year { get; set; }
        public string venue { get; set; }
        public string authors { get; set; }
        public List<string> taxonomy { get; set; }
        public List<string> keywords { get; set; }
        public bool read { get; set; }
        public string summary { get; set; }
        public string path { get; set; }
        public double sizeMB { get; set; }
    }
}
