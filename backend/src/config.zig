const std = @import("std");

pub const default_host = "127.0.0.1";
pub const default_port = 8000;
pub const password_path = "data/password.txt";
pub const public_dir = "public";

pub fn parsePort(env: *const std.process.Environ.Map) !u16 {
    const value = env.get("PORT") orelse return default_port;
    return try std.fmt.parseInt(u16, value, 10);
}
