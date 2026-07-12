const std = @import("std");
const api = @import("api.zig");
const auth = @import("auth.zig");
const config = @import("config.zig");
const http = @import("http.zig");
const static_files = @import("static.zig");
const storage = @import("store.zig");

const max_body = storage.max_document_size;
const request_arena_size = storage.scratch_size;

const RuntimeBuffers = struct {
    request_memory: [request_arena_size]u8,
    in: [http.max_header + max_body]u8,
    out: [16 * 1024]u8,
};

const App = struct {
    buffers: RuntimeBuffers,
    store: storage.Store,
    password: auth.Password,

    fn init(self: *App, io: std.Io, env: *const std.process.Environ.Map) !void {
        self.buffers = undefined;
        try self.store.init(io, &self.buffers.request_memory);
        self.password = try auth.Password.load(io, env);
    }

    fn serve(self: *App, io: std.Io, host: []const u8, port: u16) !void {
        const address = try std.Io.net.IpAddress.parse(host, port);
        var server = try address.listen(io, .{ .reuse_address = true });
        defer server.deinit(io);

        std.debug.print("Muscu Tracker Zig -> http://{s}:{d}\n", .{ host, port });
        std.debug.print("Auth API : {s}\n", .{if (self.password.active()) "activee" else "desactivee"});

        while (true) {
            const stream = server.accept(io) catch |err| switch (err) {
                error.ConnectionAborted, error.ProtocolFailure, error.BlockedByFirewall => continue,
                else => return err,
            };
            defer stream.close(io);
            self.handleConnection(io, stream) catch |err| {
                std.debug.print("request error: {}\n", .{err});
            };
        }
    }

    fn handleConnection(self: *App, io: std.Io, stream: std.Io.net.Stream) !void {
        var fba = std.heap.FixedBufferAllocator.init(&self.buffers.request_memory);
        const allocator = fba.allocator();
        var reader = stream.reader(io, &self.buffers.in);
        var writer = stream.writer(io, &self.buffers.out);
        const out = &writer.interface;
        const req = http.readRequest(&reader.interface, max_body) catch |err| switch (err) {
            error.PayloadTooLarge => return http.sendJson(out, 413, "{\"error\":\"payload too large\"}", true, null),
            error.HeadersTooLarge => return http.sendJson(out, 431, "{\"error\":\"headers too large\"}", true, null),
            error.BadRequest, error.PathTooLarge => return http.sendJson(out, 400, "{\"error\":\"bad request\"}", true, null),
        };

        if (std.mem.eql(u8, req.path, "/api/data")) {
            switch (req.method) {
                .GET => return api.handleGet(&self.password, &self.store, out, req),
                .PUT, .POST => return api.handlePut(&self.password, &self.store, io, out, allocator, req),
                else => return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null),
            }
        }
        if (req.method != .GET) return http.sendJson(out, 404, "{\"error\":\"not found\"}", false, null);
        return static_files.handle(io, out, allocator, req.path);
    }
};

var app: App = undefined;

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    try app.init(io, init.environ_map);
    const port = config.parsePort(init.environ_map) catch config.default_port;
    const host = init.environ_map.get("HOST") orelse config.default_host;
    try app.serve(io, host, port);
}
