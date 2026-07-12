const std = @import("std");

pub const max_header = 32 * 1024;
const max_path = 512;

pub const Method = enum { GET, PUT, POST, other };

pub const Request = struct {
    method: Method,
    path: []const u8,
    headers: []const u8,
    body: []const u8,
};

pub fn readRequest(in: *std.Io.Reader, max_body: usize) !Request {
    while (std.mem.indexOf(u8, in.buffered(), "\r\n\r\n") == null) {
        if (in.bufferedLen() >= max_header) return error.HeadersTooLarge;
        if (in.bufferedLen() == in.buffer.len) return error.PayloadTooLarge;
        in.fillMore() catch return error.BadRequest;
    }

    const header_end = std.mem.indexOf(u8, in.buffered(), "\r\n\r\n").?;
    if (header_end > max_header) return error.HeadersTooLarge;

    const headers = in.buffered()[0..header_end];
    const body_start = header_end + 4;
    const declared = headerInt(headers, "Content-Length") orelse 0;
    if (declared > max_body or declared > in.buffer.len - body_start) return error.PayloadTooLarge;

    const total_needed = body_start + declared;
    in.fill(total_needed) catch return error.BadRequest;
    return parseRequest(in.buffered()[0..total_needed]);
}

pub fn parseRequest(bytes: []const u8) !Request {
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

pub fn headerValue(headers: []const u8, name: []const u8) ?[]const u8 {
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

pub fn headerInt(headers: []const u8, name: []const u8) ?usize {
    const value = headerValue(headers, name) orelse return null;
    return std.fmt.parseInt(usize, value, 10) catch null;
}

pub fn sendJson(out: *std.Io.Writer, status: u16, body: []const u8, no_cache: bool, etag: ?[]const u8) !void {
    return sendResponse(out, status, body, "application/json", no_cache, etag);
}

pub fn sendResponse(out: *std.Io.Writer, status: u16, body: []const u8, content_type: []const u8, no_cache: bool, etag: ?[]const u8) !void {
    return sendParts(out, status, &.{body}, content_type, no_cache, etag);
}

pub fn sendParts(out: *std.Io.Writer, status: u16, parts: []const []const u8, content_type: []const u8, no_cache: bool, etag: ?[]const u8) !void {
    var length: usize = 0;
    for (parts) |part| length += part.len;
    try out.print("HTTP/1.1 {d} {s}\r\n", .{ status, reason(status) });
    try out.print("Content-Type: {s}\r\nContent-Length: {d}\r\n", .{ content_type, length });
    try out.writeAll("X-Content-Type-Options: nosniff\r\n");
    try out.writeAll("X-Frame-Options: DENY\r\n");
    try out.writeAll("Referrer-Policy: no-referrer\r\n");
    try out.writeAll("Permissions-Policy: camera=(), microphone=(), geolocation=()\r\n");
    try out.writeAll("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\n");
    if (no_cache) try out.writeAll("Cache-Control: no-store\r\n");
    if (etag) |value| try out.print("ETag: {s}\r\n", .{value});
    try out.writeAll("Connection: close\r\n\r\n");
    for (parts) |part| try out.writeAll(part);
    try out.flush();
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
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        else => "OK",
    };
}
