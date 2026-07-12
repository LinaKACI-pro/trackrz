const std = @import("std");
const auth = @import("auth.zig");
const document = @import("document.zig");
const http = @import("http.zig");
const storage = @import("store.zig");

pub fn handleGet(password: *const auth.Password, store: *storage.Store, out: *std.Io.Writer, req: http.Request) !void {
    if (!auth.authorized(password, req)) return http.sendJson(out, 401, "{\"error\":\"unauthorized\"}", true, null);
    var etag_buf: [48]u8 = undefined;
    const etag = try std.fmt.bufPrint(&etag_buf, "\"{d}\"", .{store.revision});
    return http.sendResponse(out, 200, store.bytes(), "application/json", true, etag);
}

pub fn handlePut(password: *const auth.Password, store: *storage.Store, io: std.Io, out: *std.Io.Writer, allocator: std.mem.Allocator, req: http.Request) !void {
    if (!auth.authorized(password, req)) return http.sendJson(out, 401, "{\"error\":\"unauthorized\"}", true, null);
    const declared = http.headerInt(req.headers, "Content-Length") orelse req.body.len;
    if (declared == 0) return http.sendJson(out, 400, "{\"error\":\"empty body\"}", true, null);
    if (declared > storage.max_document_size or req.body.len > storage.max_document_size) return http.sendJson(out, 413, "{\"error\":\"payload too large\"}", true, null);
    const body = req.body[0..@min(req.body.len, declared)];

    var current_etag_buf: [48]u8 = undefined;
    const current_etag = try std.fmt.bufPrint(&current_etag_buf, "\"{d}\"", .{store.revision});
    const expected = http.headerValue(req.headers, "If-Match") orelse {
        return http.sendResponse(out, 428, "{\"error\":\"revision required\"}", "application/json", true, current_etag);
    };
    if (!std.mem.eql(u8, expected, current_etag)) {
        var prefix_buf: [64]u8 = undefined;
        const prefix = try std.fmt.bufPrint(&prefix_buf, "{{\"error\":\"conflict\",\"revision\":{d},\"data\":", .{store.revision});
        return http.sendParts(out, 409, &.{ prefix, store.bytes(), "}" }, "application/json", true, current_etag);
    }

    var parsed = document.parse(allocator, body) catch {
        return http.sendJson(out, 400, "{\"error\":\"invalid data\"}", true, null);
    };
    defer parsed.deinit();

    const next_revision = store.revision + 1;
    try parsed.document.setRevision(next_revision);
    store.commit(io, parsed.document) catch |err| switch (err) {
        error.DocumentTooLarge => return http.sendJson(out, 413, "{\"error\":\"payload too large\"}", true, null),
        else => return err,
    };
    var new_etag_buf: [48]u8 = undefined;
    const new_etag = try std.fmt.bufPrint(&new_etag_buf, "\"{d}\"", .{next_revision});
    var ok_buf: [64]u8 = undefined;
    const ok = try std.fmt.bufPrint(&ok_buf, "{{\"ok\":true,\"revision\":{d}}}", .{next_revision});
    return http.sendResponse(out, 200, ok, "application/json", true, new_etag);
}
