const std = @import("std");
const config = @import("config.zig");
const http = @import("http.zig");

pub const Password = struct {
    buf: [256]u8,
    len: usize,

    pub fn load(io: std.Io, env: *const std.process.Environ.Map) !Password {
        var password = Password{ .buf = undefined, .len = 0 };
        if (env.get("MUSCU_PASSWORD")) |value| {
            const trimmed = std.mem.trim(u8, value, " \t\r\n");
            if (trimmed.len > 0) {
                if (trimmed.len > password.buf.len) return error.InvalidData;
                @memcpy(password.buf[0..trimmed.len], trimmed);
                password.len = trimmed.len;
                return password;
            }
        }

        if (std.Io.Dir.cwd().openFile(io, config.password_path, .{})) |file| {
            defer file.close(io);
            if (try file.length(io) > password.buf.len) return error.InvalidData;
            var reader = file.reader(io, &.{});
            const len = reader.interface.readSliceShort(&password.buf) catch return error.InvalidData;
            const trimmed = std.mem.trim(u8, password.buf[0..len], " \t\r\n");
            if (trimmed.len > 0) {
                if (trimmed.ptr != password.buf[0..].ptr) {
                    std.mem.copyForwards(u8, password.buf[0..trimmed.len], trimmed);
                }
                password.len = trimmed.len;
            }
        } else |_| {}
        return password;
    }

    pub fn active(self: *const Password) bool {
        return self.len > 0;
    }

    fn bytes(self: *const Password) []const u8 {
        return self.buf[0..self.len];
    }
};

pub fn authorized(password: *const Password, req: http.Request) bool {
    const expected = password.bytes();
    if (expected.len == 0) return true;
    const auth = http.headerValue(req.headers, "Authorization") orelse return false;
    if (!std.mem.startsWith(u8, auth, "Bearer ")) return false;
    return constantTimeEq(auth[7..], expected);
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
