const std = @import("std");
const document = @import("document.zig");
const storage = @import("store.zig");

const max_body = storage.max_document_size;
const request_arena_size = storage.scratch_size;
const max_header = 32 * 1024;
const max_path = 512;

const public_dir = "public";
const password_path = "data/password.txt";

const Method = enum { GET, PUT, POST, other };

const RuntimeBuffers = struct {
    request_memory: [request_arena_size]u8,
    io: [max_header + max_body]u8,
};

const Request = struct {
    method: Method,
    path: []const u8,
    headers: []const u8,
    body: []const u8,
};

var runtime_buffers: RuntimeBuffers = undefined;
var persistent_store: storage.Store = undefined;

const Server = struct {
    password: []const u8,
    password_buf: [256]u8,
    store: *storage.Store,

    fn init(store: *storage.Store) !Server {
        var server = Server{ .password = "", .password_buf = undefined, .store = store };
        if (std.process.getEnvVarOwned(std.heap.page_allocator, "MUSCU_PASSWORD")) |value| {
            defer std.heap.page_allocator.free(value);
            const trimmed = std.mem.trim(u8, value, " \t\r\n");
            if (trimmed.len > 0) {
                const len = @min(trimmed.len, server.password_buf.len);
                @memcpy(server.password_buf[0..len], trimmed[0..len]);
                server.password = server.password_buf[0..len];
                return server;
            }
        } else |_| {}

        if (std.fs.cwd().openFile(password_path, .{})) |file| {
            defer file.close();
            const len = try file.readAll(&server.password_buf);
            server.password = std.mem.trim(u8, server.password_buf[0..len], " \t\r\n");
        } else |_| {}
        return server;
    }

};

pub fn main() !void {
    try persistent_store.init(&runtime_buffers.request_memory);
    var server_state = try Server.init(&persistent_store);
    const port = parsePort() catch 8000;
    const host_value = std.process.getEnvVarOwned(std.heap.page_allocator, "HOST") catch null;
    defer if (host_value) |value| std.heap.page_allocator.free(value);
    const host: []const u8 = if (host_value) |value| value else "127.0.0.1";
    const address = try std.net.Address.parseIp(host, port);
    var listener = try address.listen(.{ .reuse_address = true });
    defer listener.deinit();

    std.debug.print("Muscu Tracker Zig -> http://{s}:{d}\n", .{ host, port });
    std.debug.print("Auth API : {s}\n", .{if (server_state.password.len > 0) "activee" else "desactivee"});

    while (true) {
        var connection = try listener.accept();
        defer connection.stream.close();
        handleConnection(&server_state, connection.stream, &runtime_buffers) catch |err| {
            std.debug.print("request error: {}\n", .{err});
        };
    }
}

fn parsePort() !u16 {
    const value = std.process.getEnvVarOwned(std.heap.page_allocator, "PORT") catch return 8000;
    defer std.heap.page_allocator.free(value);
    return try std.fmt.parseInt(u16, value, 10);
}

fn handleConnection(server: *Server, stream: std.net.Stream, buffers: *RuntimeBuffers) !void {
    var fba = std.heap.FixedBufferAllocator.init(&buffers.request_memory);
    const allocator = fba.allocator();

    const buf = &buffers.io;
    var n = try stream.read(buf);
    if (n == 0) return;
    while (std.mem.indexOf(u8, buf[0..n], "\r\n\r\n") == null) {
        if (n >= max_header) return error.HeadersTooLarge;
        const more = try stream.read(buf[n..]);
        if (more == 0) return error.BadRequest;
        n += more;
    }
    const header_end = std.mem.indexOf(u8, buf[0..n], "\r\n\r\n").?;
    const declared = headerInt(buf[0..header_end], "Content-Length") orelse 0;
    if (declared > max_body) return sendJson(stream, 413, "{\"error\":\"payload too large\"}", true, null);
    const total_needed = header_end + 4 + declared;
    if (total_needed > buf.len) return sendJson(stream, 413, "{\"error\":\"payload too large\"}", true, null);
    while (n < total_needed) {
        const more = try stream.read(buf[n..total_needed]);
        if (more == 0) return error.BadRequest;
        n += more;
    }

    const req = try parseRequest(buf[0..total_needed]);
    if (std.mem.eql(u8, req.path, "/api/data")) {
        switch (req.method) {
            .GET => return handleApiGet(server, stream, req),
            .PUT, .POST => return handleApiPut(server, stream, allocator, req),
            else => return sendJson(stream, 404, "{\"error\":\"not found\"}", false, null),
        }
    }
    if (req.method != .GET) return sendJson(stream, 404, "{\"error\":\"not found\"}", false, null);
    return handleStatic(stream, allocator, req.path);
}

fn parseRequest(bytes: []const u8) !Request {
    const header_end = std.mem.indexOf(u8, bytes, "\r\n\r\n") orelse return error.BadRequest;
    const head = bytes[0..header_end];
    var lines = std.mem.splitSequence(u8, head, "\r\n");
    const first = lines.next() orelse return error.BadRequest;
    var parts = std.mem.splitScalar(u8, first, ' ');
    const method_text = parts.next() orelse return error.BadRequest;
    const raw_path = parts.next() orelse return error.BadRequest;
    const path_only = if (std.mem.indexOfScalar(u8, raw_path, '?')) |i| raw_path[0..i] else raw_path;
    if (path_only.len > max_path) return error.PathTooLarge;

    const method: Method = if (std.mem.eql(u8, method_text, "GET"))
        .GET
    else if (std.mem.eql(u8, method_text, "PUT"))
        .PUT
    else if (std.mem.eql(u8, method_text, "POST"))
        .POST
    else
        .other;

    return .{
        .method = method,
        .path = path_only,
        .headers = bytes[0..header_end],
        .body = bytes[header_end + 4 ..],
    };
}

fn handleApiGet(server: *Server, stream: std.net.Stream, req: Request) !void {
    if (!authorized(server, req)) return sendJson(stream, 401, "{\"error\":\"unauthorized\"}", true, null);
    var etag_buf: [48]u8 = undefined;
    const etag = try std.fmt.bufPrint(&etag_buf, "\"{d}\"", .{server.store.revision});
    return sendResponse(stream, 200, server.store.bytes(), "application/json", true, etag);
}

fn handleApiPut(server: *Server, stream: std.net.Stream, allocator: std.mem.Allocator, req: Request) !void {
    if (!authorized(server, req)) return sendJson(stream, 401, "{\"error\":\"unauthorized\"}", true, null);
    const declared = headerInt(req.headers, "Content-Length") orelse req.body.len;
    if (declared == 0) return sendJson(stream, 400, "{\"error\":\"empty body\"}", true, null);
    if (declared > max_body or req.body.len > max_body) return sendJson(stream, 413, "{\"error\":\"payload too large\"}", true, null);
    const body = req.body[0..@min(req.body.len, declared)];

    var parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch {
        return sendJson(stream, 400, "{\"error\":\"invalid data\"}", true, null);
    };
    defer parsed.deinit();
    document.validate(allocator, parsed.value) catch {
        return sendJson(stream, 400, "{\"error\":\"invalid data\"}", true, null);
    };

    var current_etag_buf: [48]u8 = undefined;
    const current_etag = try std.fmt.bufPrint(&current_etag_buf, "\"{d}\"", .{server.store.revision});
    const expected = headerValue(req.headers, "If-Match") orelse {
        return sendResponse(stream, 428, "{\"error\":\"revision required\"}", "application/json", true, current_etag);
    };
    if (!std.mem.eql(u8, expected, current_etag)) {
        var conflict = std.ArrayList(u8).init(allocator);
        try conflict.writer().print("{{\"error\":\"conflict\",\"revision\":{d},\"data\":", .{server.store.revision});
        try conflict.appendSlice(server.store.bytes());
        try conflict.append('}');
        return sendResponse(stream, 409, conflict.items, "application/json", true, current_etag);
    }

    const next_revision = server.store.revision + 1;
    try document.setRevision(&parsed.value, next_revision);
    server.store.commit(parsed.value, next_revision) catch |err| switch (err) {
        error.DocumentTooLarge => return sendJson(stream, 413, "{\"error\":\"payload too large\"}", true, null),
        else => return err,
    };
    var new_etag_buf: [48]u8 = undefined;
    const new_etag = try std.fmt.bufPrint(&new_etag_buf, "\"{d}\"", .{next_revision});
    var ok_buf: [64]u8 = undefined;
    const ok = try std.fmt.bufPrint(&ok_buf, "{{\"ok\":true,\"revision\":{d}}}", .{next_revision});
    return sendResponse(stream, 200, ok, "application/json", true, new_etag);
}

fn authorized(server: *Server, req: Request) bool {
    if (server.password.len == 0) return true;
    const auth = headerValue(req.headers, "Authorization") orelse return false;
    if (!std.mem.startsWith(u8, auth, "Bearer ")) return false;
    return constantTimeEq(auth[7..], server.password);
}

fn constantTimeEq(a: []const u8, b: []const u8) bool {
    var diff: u8 = @intCast(a.len ^ b.len);
    const n = @max(a.len, b.len);
    for (0..n) |i| {
        const av: u8 = if (i < a.len) a[i] else 0;
        const bv: u8 = if (i < b.len) b[i] else 0;
        diff |= av ^ bv;
    }
    return diff == 0;
}

fn handleStatic(stream: std.net.Stream, allocator: std.mem.Allocator, req_path: []const u8) !void {
    const normalized = if (std.mem.eql(u8, req_path, "/")) "/index.html" else req_path;
    if (std.mem.indexOf(u8, normalized, "..") != null or std.mem.indexOfScalar(u8, normalized, 0) != null) {
        return sendJson(stream, 404, "{\"error\":\"not found\"}", false, null);
    }
    const relative = std.mem.trimLeft(u8, normalized, "/");
    if (std.mem.startsWith(u8, relative, ".")) return sendJson(stream, 404, "{\"error\":\"not found\"}", false, null);
    const path = try std.fs.path.join(allocator, &.{ public_dir, relative });
    const file = std.fs.cwd().openFile(path, .{}) catch return sendJson(stream, 404, "{\"error\":\"not found\"}", false, null);
    defer file.close();
    const body = try file.readToEndAlloc(allocator, max_body);
    const content_type = mimeFor(path);
    const no_cache = std.mem.endsWith(u8, path, ".html") or std.mem.endsWith(u8, path, ".js") or std.mem.endsWith(u8, path, ".css") or std.mem.endsWith(u8, path, ".webmanifest");
    return sendResponse(stream, 200, body, content_type, no_cache, null);
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

fn headerValue(headers: []const u8, name: []const u8) ?[]const u8 {
    var lines = std.mem.splitSequence(u8, headers, "\r\n");
    _ = lines.next();
    while (lines.next()) |line| {
        if (line.len <= name.len + 1) continue;
        if (std.ascii.eqlIgnoreCase(line[0..name.len], name) and line[name.len] == ':') {
            return std.mem.trim(u8, line[name.len + 1 ..], " \t");
        }
    }
    return null;
}

fn headerInt(headers: []const u8, name: []const u8) ?usize {
    const value = headerValue(headers, name) orelse return null;
    return std.fmt.parseInt(usize, value, 10) catch null;
}

fn sendJson(stream: std.net.Stream, status: u16, body: []const u8, no_cache: bool, etag: ?[]const u8) !void {
    return sendResponse(stream, status, body, "application/json", no_cache, etag);
}

fn sendResponse(stream: std.net.Stream, status: u16, body: []const u8, content_type: []const u8, no_cache: bool, etag: ?[]const u8) !void {
    var header_buf: [2048]u8 = undefined;
    var fixed = std.io.fixedBufferStream(&header_buf);
    const writer = fixed.writer();
    try writer.print("HTTP/1.1 {d} {s}\r\n", .{ status, reason(status) });
    try writer.print("Content-Type: {s}\r\nContent-Length: {d}\r\n", .{ content_type, body.len });
    try writer.writeAll("X-Content-Type-Options: nosniff\r\n");
    try writer.writeAll("X-Frame-Options: DENY\r\n");
    try writer.writeAll("Referrer-Policy: no-referrer\r\n");
    try writer.writeAll("Permissions-Policy: camera=(), microphone=(), geolocation=()\r\n");
    try writer.writeAll("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\n");
    if (no_cache) try writer.writeAll("Cache-Control: no-store\r\n");
    if (etag) |value| try writer.print("ETag: {s}\r\n", .{value});
    try writer.writeAll("Connection: close\r\n\r\n");
    try stream.writeAll(fixed.getWritten());
    try stream.writeAll(body);
}

fn reason(status: u16) []const u8 {
    return switch (status) {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        428 => "Precondition Required",
        500 => "Internal Server Error",
        else => "OK",
    };
}
