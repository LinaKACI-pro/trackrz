const std = @import("std");

pub const Limits = struct {
    pub const max_exercises = 1_000;
    pub const max_sessions = 10_000;
    pub const max_session_exercises = 100;
    pub const max_sets = 100;
    pub const max_identifier = 128;
    pub const max_name = 120;
    pub const max_group = 60;
};

pub fn validate(allocator: std.mem.Allocator, value: std.json.Value) !void {
    const root = try objectOf(value);
    if (root.get("version")) |version| {
        if (try integerOf(version) != 1) return error.InvalidData;
    }
    if (root.get("revision")) |revision_value| {
        if (try integerOf(revision_value) < 0) return error.InvalidData;
    }

    const exercises = try arrayOf(root.get("exercises") orelse return error.InvalidData);
    const sessions = try arrayOf(root.get("sessions") orelse return error.InvalidData);
    if (exercises.items.len > Limits.max_exercises or sessions.items.len > Limits.max_sessions) {
        return error.InvalidData;
    }

    var exercise_ids = std.StringHashMap(void).init(allocator);
    defer exercise_ids.deinit();
    var session_ids = std.StringHashMap(void).init(allocator);
    defer session_ids.deinit();

    for (exercises.items) |exercise| {
        const item = try objectOf(exercise);
        const id = try identifierOf(item.get("id") orelse return error.InvalidData);
        if (exercise_ids.contains(id)) return error.InvalidData;
        try exercise_ids.put(id, {});
        try textOf(item.get("name") orelse return error.InvalidData, Limits.max_name);
        if (item.get("group")) |group| try textOf(group, Limits.max_group);
        if (item.get("type")) |kind| try exerciseTypeOf(kind);
    }

    for (sessions.items) |session| {
        const item = try objectOf(session);
        const id = try identifierOf(item.get("id") orelse return error.InvalidData);
        if (session_ids.contains(id)) return error.InvalidData;
        try session_ids.put(id, {});
        try dateOf(item.get("date") orelse return error.InvalidData);

        const session_exercises = try arrayOf(item.get("exos") orelse return error.InvalidData);
        if (session_exercises.items.len > Limits.max_session_exercises) return error.InvalidData;
        var seen_exercises = std.StringHashMap(void).init(allocator);
        defer seen_exercises.deinit();
        for (session_exercises.items) |session_exercise| {
            const entry = try objectOf(session_exercise);
            const exercise_id = try identifierOf(entry.get("exoId") orelse return error.InvalidData);
            if (!exercise_ids.contains(exercise_id) or seen_exercises.contains(exercise_id)) return error.InvalidData;
            try seen_exercises.put(exercise_id, {});

            const sets = try arrayOf(entry.get("sets") orelse return error.InvalidData);
            if (sets.items.len == 0 or sets.items.len > Limits.max_sets) return error.InvalidData;
            for (sets.items) |set| try validateSet(set);
        }
    }
}

pub fn revision(value: std.json.Value) !i64 {
    const root = try objectOf(value);
    const value_revision = root.get("revision") orelse return 0;
    const result = try integerOf(value_revision);
    if (result < 0) return error.InvalidData;
    return result;
}

pub fn setRevision(value: *std.json.Value, new_revision: i64) !void {
    switch (value.*) {
        .object => |*root| try root.put("revision", .{ .integer = new_revision }),
        else => return error.InvalidData,
    }
}

fn validateSet(value: std.json.Value) !void {
    const set = try objectOf(value);
    try numberOf(set.get("reps") orelse return error.InvalidData, 0.01, 10_000);
    if (set.get("weight")) |weight| try numberOf(weight, 0, 100_000);
}

fn objectOf(value: std.json.Value) !std.json.ObjectMap {
    return switch (value) {
        .object => |object| object,
        else => error.InvalidData,
    };
}

fn arrayOf(value: std.json.Value) !std.json.Array {
    return switch (value) {
        .array => |array| array,
        else => error.InvalidData,
    };
}

fn integerOf(value: std.json.Value) !i64 {
    return switch (value) {
        .integer => |integer| integer,
        else => error.InvalidData,
    };
}

fn identifierOf(value: std.json.Value) ![]const u8 {
    const text = switch (value) {
        .string => |string| string,
        else => return error.InvalidData,
    };
    if (text.len == 0 or text.len > Limits.max_identifier) return error.InvalidData;
    for (text) |character| {
        const valid = std.ascii.isAlphanumeric(character) or character == '_' or character == '-';
        if (!valid) return error.InvalidData;
    }
    return text;
}

fn textOf(value: std.json.Value, max_length: usize) !void {
    const text = switch (value) {
        .string => |string| string,
        else => return error.InvalidData,
    };
    if (std.mem.trim(u8, text, " \t\r\n").len == 0 or text.len > max_length) return error.InvalidData;
}

fn exerciseTypeOf(value: std.json.Value) !void {
    const kind = switch (value) {
        .string => |string| string,
        else => return error.InvalidData,
    };
    if (!std.mem.eql(u8, kind, "charge") and !std.mem.eql(u8, kind, "pdc") and !std.mem.eql(u8, kind, "assistance")) {
        return error.InvalidData;
    }
}

fn dateOf(value: std.json.Value) !void {
    const text = switch (value) {
        .string => |string| string,
        else => return error.InvalidData,
    };
    if (text.len != 10 or text[4] != '-' or text[7] != '-') return error.InvalidData;
    const year = std.fmt.parseInt(u16, text[0..4], 10) catch return error.InvalidData;
    const month = std.fmt.parseInt(u8, text[5..7], 10) catch return error.InvalidData;
    const day = std.fmt.parseInt(u8, text[8..10], 10) catch return error.InvalidData;
    if (year == 0 or month == 0 or month > 12 or day == 0 or day > daysInMonth(year, month)) return error.InvalidData;
}

fn daysInMonth(year: u16, month: u8) u8 {
    return switch (month) {
        2 => if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) 29 else 28,
        4, 6, 9, 11 => 30,
        else => 31,
    };
}

fn numberOf(value: std.json.Value, minimum: f64, maximum: f64) !void {
    const number: f64 = switch (value) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| float,
        else => return error.InvalidData,
    };
    if (!std.math.isFinite(number) or number < minimum or number > maximum) return error.InvalidData;
}

test "validates references, duplicates and calendar dates" {
    const valid =
        \\{"version":1,"exercises":[{"id":"squat","name":"Squat"}],"sessions":[{"id":"s1","date":"2024-02-29","exos":[{"exoId":"squat","sets":[{"reps":8,"weight":80}]}]}]}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, valid, .{});
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);

    const invalid_date =
        \\{"exercises":[{"id":"squat","name":"Squat"}],"sessions":[{"id":"s1","date":"2023-02-29","exos":[]}]}
    ;
    var bad = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, invalid_date, .{});
    defer bad.deinit();
    try std.testing.expectError(error.InvalidData, validate(std.testing.allocator, bad.value));
}
