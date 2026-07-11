const std = @import("std");
const document = @import("document.zig");

pub const max_document_size = 2 * 1024 * 1024;
pub const scratch_size = 8 * 1024 * 1024;

const data_dir = "data";
const current_name = "muscu-data.json";
const backup_name = "muscu-data.bak.json";
const temporary_name = "muscu-data.tmp";
const empty_document = "{\"version\":1,\"revision\":0,\"exercises\":[],\"sessions\":[]}";

pub const Store = struct {
    snapshots: [2][max_document_size]u8,
    lengths: [2]usize,
    active: usize,
    revision: i64,

    pub fn init(self: *Store, scratch: []u8) !void {
        self.lengths = .{ 0, 0 };
        self.active = 0;
        self.revision = 0;
        try std.fs.cwd().makePath(data_dir);

        if (self.loadPath(current_name, scratch)) |loaded_revision| {
            self.revision = loaded_revision;
            return;
        } else |_| {}

        if (self.loadPath(backup_name, scratch)) |loaded_revision| {
            self.revision = loaded_revision;
            std.debug.print("storage: recovered valid backup\n", .{});
            return;
        } else |_| {}

        var directory = try std.fs.cwd().openDir(data_dir, .{});
        defer directory.close();
        const has_current = pathExists(directory, current_name);
        const has_backup = pathExists(directory, backup_name);
        if (has_current or has_backup) return error.DataUnavailable;

        @memcpy(self.snapshots[0][0..empty_document.len], empty_document);
        self.lengths[0] = empty_document.len;
    }

    pub fn bytes(self: *const Store) []const u8 {
        return self.snapshots[self.active][0..self.lengths[self.active]];
    }

    pub fn commit(self: *Store, value: std.json.Value, new_revision: i64) !void {
        const next = 1 - self.active;
        var output = std.io.fixedBufferStream(&self.snapshots[next]);
        std.json.stringify(value, .{ .whitespace = .indent_2 }, output.writer()) catch |err| switch (err) {
            error.NoSpaceLeft => return error.DocumentTooLarge,
            else => return err,
        };
        const length = output.pos;
        try persist(self.snapshots[next][0..length]);
        self.lengths[next] = length;
        self.active = next;
        self.revision = new_revision;
    }

    fn loadPath(self: *Store, name: []const u8, scratch: []u8) !i64 {
        var directory = try std.fs.cwd().openDir(data_dir, .{});
        defer directory.close();
        const file = try directory.openFile(name, .{});
        defer file.close();
        const size = try file.getEndPos();
        if (size == 0 or size > max_document_size) return error.InvalidData;
        const length = try file.readAll(&self.snapshots[0]);

        var fixed = std.heap.FixedBufferAllocator.init(scratch);
        var parsed = try std.json.parseFromSlice(std.json.Value, fixed.allocator(), self.snapshots[0][0..length], .{});
        defer parsed.deinit();
        try document.validate(fixed.allocator(), parsed.value);
        self.lengths[0] = length;
        return document.revision(parsed.value);
    }
};

fn pathExists(directory: std.fs.Dir, name: []const u8) bool {
    directory.access(name, .{}) catch return false;
    return true;
}

fn persist(bytes: []const u8) !void {
    var directory = try std.fs.cwd().openDir(data_dir, .{});
    defer directory.close();

    {
        const temporary = try directory.createFile(temporary_name, .{ .truncate = true });
        defer temporary.close();
        try temporary.writeAll(bytes);
        try temporary.sync();
    }

    if (pathExists(directory, current_name)) {
        directory.deleteFile(backup_name) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };
        try directory.rename(current_name, backup_name);
    }
    try directory.rename(temporary_name, current_name);
    try std.posix.fsync(directory.fd);
}
