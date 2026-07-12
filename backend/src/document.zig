const std = @import("std");
const json = @import("json_decode.zig");

pub const Limits = struct {
    pub const max_exercises = 1_000;
    pub const max_sessions = 10_000;
    pub const max_session_exercises = 100;
    pub const max_sets = 100;
    pub const max_identifier = 128;
    pub const max_name = 120;
    pub const max_group = 60;
};

pub const ExerciseKind = enum {
    charge,
    pdc,
    assistance,

    fn parse(text: []const u8) !ExerciseKind {
        if (std.mem.eql(u8, text, "charge")) return .charge;
        if (std.mem.eql(u8, text, "pdc")) return .pdc;
        if (std.mem.eql(u8, text, "assistance")) return .assistance;
        return error.InvalidData;
    }

    fn write(self: ExerciseKind, writer: *std.Io.Writer) !void {
        const text = switch (self) {
            .charge => "charge",
            .pdc => "pdc",
            .assistance => "assistance",
        };
        try writeJsonString(writer, text);
    }
};

pub const Number = union(enum) {
    integer: i64,
    float: f64,

    fn parse(value: std.json.Value, minimum: f64, maximum: f64) !Number {
        const result: Number = switch (value) {
            .integer => |integer| .{ .integer = integer },
            .float => |float| .{ .float = float },
            else => return error.InvalidData,
        };
        const number = result.asF64();
        if (!std.math.isFinite(number) or number < minimum or number > maximum) return error.InvalidData;
        return result;
    }

    fn asF64(self: Number) f64 {
        return switch (self) {
            .integer => |integer| @floatFromInt(integer),
            .float => |float| float,
        };
    }

    fn write(self: Number, writer: *std.Io.Writer) !void {
        switch (self) {
            .integer => |integer| try writer.print("{d}", .{integer}),
            .float => |float| try std.json.Stringify.value(float, .{}, writer),
        }
    }
};

pub const Date = struct {
    year: u16,
    month: u8,
    day: u8,

    fn parse(text: []const u8) !Date {
        if (text.len != 10 or text[4] != '-' or text[7] != '-') return error.InvalidData;
        const year = std.fmt.parseInt(u16, text[0..4], 10) catch return error.InvalidData;
        const month = std.fmt.parseInt(u8, text[5..7], 10) catch return error.InvalidData;
        const day = std.fmt.parseInt(u8, text[8..10], 10) catch return error.InvalidData;
        if (year == 0 or month == 0 or month > 12 or day == 0 or day > daysInMonth(year, month)) return error.InvalidData;
        return .{ .year = year, .month = month, .day = day };
    }

    fn write(self: Date, writer: *std.Io.Writer) !void {
        try writer.print("\"{d:0>4}-{d:0>2}-{d:0>2}\"", .{ self.year, self.month, self.day });
    }
};

pub const Exercise = struct {
    id: []const u8,
    name: []const u8,
    group: ?[]const u8,
    kind: ?ExerciseKind,
};

pub const Session = struct {
    id: []const u8,
    date: Date,
    exercises_start: u32,
    exercises_len: u16,
};

pub const SessionExercise = struct {
    exo_id: []const u8,
    sets_start: u32,
    sets_len: u16,
};

pub const Set = struct {
    reps: Number,
    weight: ?Number,
};

pub const Document = struct {
    revision: i64,
    exercises: []Exercise,
    sessions: []Session,
    session_exercises: []SessionExercise,
    sets: []Set,

    pub fn deinit(self: *Document, allocator: std.mem.Allocator) void {
        allocator.free(self.exercises);
        allocator.free(self.sessions);
        allocator.free(self.session_exercises);
        allocator.free(self.sets);
        self.* = .{
            .revision = 0,
            .exercises = &.{},
            .sessions = &.{},
            .session_exercises = &.{},
            .sets = &.{},
        };
    }

    pub fn setRevision(self: *Document, new_revision: i64) !void {
        if (new_revision < 0) return error.InvalidData;
        self.revision = new_revision;
    }

    pub fn serialize(self: Document, writer: *std.Io.Writer) !void {
        try writer.print("{{\"version\":1,\"revision\":{d},\"exercises\":[", .{self.revision});
        for (self.exercises, 0..) |exercise, index| {
            if (index != 0) try writer.writeByte(',');
            try writer.writeAll("{\"id\":");
            try writeJsonString(writer, exercise.id);
            try writer.writeAll(",\"name\":");
            try writeJsonString(writer, exercise.name);
            if (exercise.group) |group| {
                try writer.writeAll(",\"group\":");
                try writeJsonString(writer, group);
            }
            if (exercise.kind) |kind| {
                try writer.writeAll(",\"type\":");
                try kind.write(writer);
            }
            try writer.writeByte('}');
        }

        try writer.writeAll("],\"sessions\":[");
        for (self.sessions, 0..) |session, session_index| {
            if (session_index != 0) try writer.writeByte(',');
            try writer.writeAll("{\"id\":");
            try writeJsonString(writer, session.id);
            try writer.writeAll(",\"date\":");
            try session.date.write(writer);
            try writer.writeAll(",\"exos\":[");
            const end = session.exercises_start + session.exercises_len;
            for (self.session_exercises[session.exercises_start..end], 0..) |entry, entry_index| {
                if (entry_index != 0) try writer.writeByte(',');
                try writer.writeAll("{\"exoId\":");
                try writeJsonString(writer, entry.exo_id);
                try writer.writeAll(",\"sets\":[");
                const sets_end = entry.sets_start + entry.sets_len;
                for (self.sets[entry.sets_start..sets_end], 0..) |set, set_index| {
                    if (set_index != 0) try writer.writeByte(',');
                    try writer.writeAll("{\"reps\":");
                    try set.reps.write(writer);
                    if (set.weight) |weight| {
                        try writer.writeAll(",\"weight\":");
                        try weight.write(writer);
                    }
                    try writer.writeByte('}');
                }
                try writer.writeAll("]}");
            }
            try writer.writeAll("]}");
        }
        try writer.writeAll("]}");
    }
};

pub const Parsed = struct {
    allocator: std.mem.Allocator,
    tree: std.json.Parsed(std.json.Value),
    document: Document,

    pub fn deinit(self: *Parsed) void {
        self.document.deinit(self.allocator);
        self.tree.deinit();
    }
};

pub fn parse(allocator: std.mem.Allocator, bytes: []const u8) !Parsed {
    var tree = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{});
    errdefer tree.deinit();
    const parsed_document = try fromValue(allocator, tree.value);
    return .{ .allocator = allocator, .tree = tree, .document = parsed_document };
}

fn fromValue(allocator: std.mem.Allocator, value: std.json.Value) !Document {
    const root = try json.object(value);

    if (root.get("version")) |version| {
        if (try json.integer(version) != 1) return error.InvalidData;
    }

    var revision: i64 = 0;
    if (root.get("revision")) |revision_value| {
        revision = try json.integer(revision_value);
        if (revision < 0) return error.InvalidData;
    }

    const exercise_values = try json.requiredArray(root, "exercises");
    const session_values = try json.requiredArray(root, "sessions");
    if (exercise_values.items.len > Limits.max_exercises or session_values.items.len > Limits.max_sessions) {
        return error.InvalidData;
    }

    var total_session_exercises: usize = 0;
    var total_sets: usize = 0;
    for (session_values.items) |session_value| {
        const session = try json.object(session_value);
        const session_exercises = try json.requiredArray(session, "exos");
        if (session_exercises.items.len > Limits.max_session_exercises) return error.InvalidData;
        total_session_exercises += session_exercises.items.len;

        for (session_exercises.items) |session_exercise_value| {
            const session_exercise = try json.object(session_exercise_value);
            const sets = try json.requiredArray(session_exercise, "sets");
            if (sets.items.len == 0 or sets.items.len > Limits.max_sets) return error.InvalidData;
            total_sets += sets.items.len;
        }
    }
    if (total_session_exercises > std.math.maxInt(u32) or total_sets > std.math.maxInt(u32)) return error.InvalidData;

    var document = Document{
        .revision = revision,
        .exercises = try allocator.alloc(Exercise, exercise_values.items.len),
        .sessions = try allocator.alloc(Session, session_values.items.len),
        .session_exercises = try allocator.alloc(SessionExercise, total_session_exercises),
        .sets = try allocator.alloc(Set, total_sets),
    };
    errdefer document.deinit(allocator);

    var exercise_ids = std.StringHashMap(void).init(allocator);
    defer exercise_ids.deinit();
    for (exercise_values.items, 0..) |exercise_value, index| {
        const exercise = try parseExercise(exercise_value);
        if (exercise_ids.contains(exercise.id)) return error.InvalidData;
        try exercise_ids.put(exercise.id, {});
        document.exercises[index] = exercise;
    }

    var session_ids = std.StringHashMap(void).init(allocator);
    defer session_ids.deinit();
    var session_exercise_index: usize = 0;
    var set_index: usize = 0;
    for (session_values.items, 0..) |session_value, session_index| {
        const session = try json.object(session_value);
        const id = try parseIdentifier(try json.requiredString(session, "id"));
        if (session_ids.contains(id)) return error.InvalidData;
        try session_ids.put(id, {});

        const session_exercises = try json.requiredArray(session, "exos");
        const exercise_start = session_exercise_index;
        document.sessions[session_index] = .{
            .id = id,
            .date = try Date.parse(try json.requiredString(session, "date")),
            .exercises_start = @intCast(exercise_start),
            .exercises_len = @intCast(session_exercises.items.len),
        };

        for (session_exercises.items) |session_exercise_value| {
            const entry = try json.object(session_exercise_value);
            // A session may reference a deleted exercise: history outlives the
            // exercise library, so the id only has to be well-formed, not known.
            const exercise_id = try parseIdentifier(try json.requiredString(entry, "exoId"));
            for (document.session_exercises[exercise_start..session_exercise_index]) |previous| {
                if (std.mem.eql(u8, previous.exo_id, exercise_id)) return error.InvalidData;
            }

            const sets = try json.requiredArray(entry, "sets");
            const sets_start = set_index;
            document.session_exercises[session_exercise_index] = .{
                .exo_id = exercise_id,
                .sets_start = @intCast(sets_start),
                .sets_len = @intCast(sets.items.len),
            };
            session_exercise_index += 1;

            for (sets.items) |set_value| {
                document.sets[set_index] = try parseSet(set_value);
                set_index += 1;
            }
        }
    }

    std.debug.assert(session_exercise_index == document.session_exercises.len);
    std.debug.assert(set_index == document.sets.len);
    return document;
}

fn parseExercise(value: std.json.Value) !Exercise {
    const exercise = try json.object(value);

    var group: ?[]const u8 = null;
    if (try json.optionalString(exercise, "group")) |text| {
        group = try parseText(text, Limits.max_group);
    }

    var kind: ?ExerciseKind = null;
    if (try json.optionalString(exercise, "type")) |text| {
        kind = try ExerciseKind.parse(text);
    }

    return .{
        .id = try parseIdentifier(try json.requiredString(exercise, "id")),
        .name = try parseText(try json.requiredString(exercise, "name"), Limits.max_name),
        .group = group,
        .kind = kind,
    };
}

fn parseSet(value: std.json.Value) !Set {
    const set = try json.object(value);

    var weight: ?Number = null;
    if (set.get("weight")) |value_weight| {
        weight = try Number.parse(value_weight, 0, 100_000);
    }

    return .{
        .reps = try Number.parse(try json.required(set, "reps"), 0.01, 10_000),
        .weight = weight,
    };
}

fn parseIdentifier(text: []const u8) ![]const u8 {
    if (text.len == 0 or text.len > Limits.max_identifier) return error.InvalidData;
    for (text) |character| {
        const valid = std.ascii.isAlphanumeric(character) or character == '_' or character == '-';
        if (!valid) return error.InvalidData;
    }
    return text;
}

fn parseText(text: []const u8, max_length: usize) ![]const u8 {
    if (std.mem.trim(u8, text, " \t\r\n").len == 0 or text.len > max_length) return error.InvalidData;
    return text;
}

fn daysInMonth(year: u16, month: u8) u8 {
    return switch (month) {
        2 => if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) 29 else 28,
        4, 6, 9, 11 => 30,
        else => 31,
    };
}

fn writeJsonString(writer: *std.Io.Writer, text: []const u8) !void {
    try std.json.Stringify.encodeJsonString(text, .{}, writer);
}

test "parses references, duplicates and calendar dates into typed data" {
    const valid =
        \\{"version":1,"exercises":[{"id":"squat","name":"Squat"}],"sessions":[{"id":"s1","date":"2024-02-29","exos":[{"exoId":"squat","sets":[{"reps":8,"weight":80}]}]}]}
    ;
    var parsed = try parse(std.testing.allocator, valid);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 1), parsed.document.exercises.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.document.sessions.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.document.session_exercises.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.document.sets.len);
    try parsed.document.setRevision(3);
    var out: [512]u8 = undefined;
    var stream: std.Io.Writer = .fixed(&out);
    try parsed.document.serialize(&stream);
    try std.testing.expect(std.mem.indexOf(u8, stream.buffered(), "\"revision\":3") != null);

    const invalid_date =
        \\{"exercises":[{"id":"squat","name":"Squat"}],"sessions":[{"id":"s1","date":"2023-02-29","exos":[]}]}
    ;
    try std.testing.expectError(error.InvalidData, parse(std.testing.allocator, invalid_date));
}

test "keeps sessions that reference a deleted exercise" {
    const orphan =
        \\{"version":1,"exercises":[],"sessions":[{"id":"s1","date":"2026-07-01","exos":[{"exoId":"gone","sets":[{"reps":10}]}]}]}
    ;
    var parsed = try parse(std.testing.allocator, orphan);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 0), parsed.document.exercises.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.document.session_exercises.len);
    try std.testing.expectEqualStrings("gone", parsed.document.session_exercises[0].exo_id);

    var out: [512]u8 = undefined;
    var stream: std.Io.Writer = .fixed(&out);
    try parsed.document.serialize(&stream);
    try std.testing.expect(std.mem.indexOf(u8, stream.buffered(), "\"exoId\":\"gone\"") != null);

    const duplicate_in_session =
        \\{"version":1,"exercises":[],"sessions":[{"id":"s1","date":"2026-07-01","exos":[{"exoId":"gone","sets":[{"reps":10}]},{"exoId":"gone","sets":[{"reps":8}]}]}]}
    ;
    try std.testing.expectError(error.InvalidData, parse(std.testing.allocator, duplicate_in_session));
}
