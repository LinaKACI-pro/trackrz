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

    pub fn init(self: *Store, io: std.Io, scratch: []u8) !void {
        self.lengths = .{ 0, 0 };
        self.active = 0;
        self.revision = 0;
        try std.Io.Dir.cwd().createDirPath(io, data_dir);

        if (self.loadPath(io, current_name, scratch)) |loaded_revision| {
            self.revision = loaded_revision;
            return;
        } else |_| {}

        if (self.loadPath(io, backup_name, scratch)) |loaded_revision| {
            self.revision = loaded_revision;
            std.debug.print("storage: recovered valid backup\n", .{});
            return;
        } else |_| {}

        var directory = try std.Io.Dir.cwd().openDir(io, data_dir, .{});
        defer directory.close(io);
        const has_current = pathExists(io, directory, current_name);
        const has_backup = pathExists(io, directory, backup_name);
        if (has_current or has_backup) return error.DataUnavailable;

        @memcpy(self.snapshots[0][0..empty_document.len], empty_document);
        self.lengths[0] = empty_document.len;
    }

    pub fn bytes(self: *const Store) []const u8 {
        return self.snapshots[self.active][0..self.lengths[self.active]];
    }

    pub fn commit(self: *Store, io: std.Io, value: document.Document) !void {
        const next = 1 - self.active;
        var output: std.Io.Writer = .fixed(&self.snapshots[next]);
        value.serialize(&output) catch |err| switch (err) {
            error.WriteFailed => return error.DocumentTooLarge,
        };
        const length = output.end;
        try persist(io, self.snapshots[next][0..length]);
        self.lengths[next] = length;
        self.active = next;
        self.revision = value.revision;
    }

    fn loadPath(self: *Store, io: std.Io, name: []const u8, scratch: []u8) !i64 {
        var directory = try std.Io.Dir.cwd().openDir(io, data_dir, .{});
        defer directory.close(io);
        const file = try directory.openFile(io, name, .{});
        defer file.close(io);
        const size = try file.length(io);
        if (size == 0 or size > max_document_size) return error.InvalidData;
        var reader = file.reader(io, &.{});
        const length = reader.interface.readSliceShort(&self.snapshots[0]) catch return error.InvalidData;

        var fixed = std.heap.FixedBufferAllocator.init(scratch);
        var parsed = try document.parse(fixed.allocator(), self.snapshots[0][0..length]);
        defer parsed.deinit();
        self.lengths[0] = length;
        return parsed.document.revision;
    }
};

fn pathExists(io: std.Io, directory: std.Io.Dir, name: []const u8) bool {
    directory.access(io, name, .{}) catch return false;
    return true;
}

fn persist(io: std.Io, data: []const u8) !void {
    var directory = try std.Io.Dir.cwd().openDir(io, data_dir, .{});
    defer directory.close(io);

    {
        const temporary = try directory.createFile(io, temporary_name, .{});
        defer temporary.close(io);
        var writer = temporary.writer(io, &.{});
        try writer.interface.writeAll(data);
        try writer.interface.flush();
        try temporary.sync(io);
    }

    if (pathExists(io, directory, current_name)) {
        directory.deleteFile(io, backup_name) catch |err| switch (err) {
            error.FileNotFound => {},
            else => return err,
        };
        try directory.rename(current_name, directory, backup_name, io);
    }
    try directory.rename(temporary_name, directory, current_name, io);
    const directory_file = std.Io.File{ .handle = directory.handle, .flags = .{ .nonblocking = false } };
    try directory_file.sync(io);
}
