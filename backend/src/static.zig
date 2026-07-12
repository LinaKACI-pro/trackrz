const std = @import("std");
const config = @import("config.zig");
const http = @import("http.zig");
const storage = @import("store.zig");

pub fn handle(io: std.Io, out: *std.Io.Writer, allocator: std.mem.Allocator, req_path: []const u8) !void {
    const normalized = if (std.mem.eql(u8, req_path, "/")) "/index.html" else req_path;
    if (std.mem.indexOf(u8, normalized, "..") != null or std.mem.indexOfScalar(u8, normalized, 0) != null) {
        return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null);
    }
    const relative = std.mem.trimStart(u8, normalized, "/");
    if (std.mem.startsWith(u8, relative, ".")) return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null);
    var path_buf: [1024]u8 = undefined;
    const path = std.fmt.bufPrint(&path_buf, config.public_dir ++ "/{s}", .{relative}) catch {
        return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null);
    };
    const body = std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(storage.max_document_size)) catch {
        return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null);
    };
    const content_type = mimeFor(path);
    const no_cache = std.mem.endsWith(u8, path, ".html") or std.mem.endsWith(u8, path, ".js") or std.mem.endsWith(u8, path, ".css") or std.mem.endsWith(u8, path, ".webmanifest");
    return http.sendResponse(out, 200, body, content_type, no_cache, null);
}

fn mimeFor(path: []const u8) []const u8 {
    if (std.mem.endsWith(u8, path, ".html")) return "text/html; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".js")) return "text/javascript";
    if (std.mem.endsWith(u8, path, ".css")) return "text/css";
    if (std.mem.endsWith(u8, path, ".json")) return "application/json";
    if (std.mem.endsWith(u8, path, ".png")) return "image/png";
    if (std.mem.endsWith(u8, path, ".webmanifest")) return "application/manifest+json";
    return "application/octet-stream";
}
