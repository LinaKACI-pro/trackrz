const std = @import("std");

pub const Object = std.json.ObjectMap;
pub const Array = std.json.Array;

pub fn object(value: std.json.Value) !Object {
    return switch (value) {
        .object => |item| item,
        else => error.InvalidData,
    };
}

pub fn array(value: std.json.Value) !Array {
    return switch (value) {
        .array => |item| item,
        else => error.InvalidData,
    };
}

pub fn string(value: std.json.Value) ![]const u8 {
    return switch (value) {
        .string => |item| item,
        else => error.InvalidData,
    };
}

pub fn integer(value: std.json.Value) !i64 {
    return switch (value) {
        .integer => |item| item,
        else => error.InvalidData,
    };
}

pub fn required(parent: Object, key: []const u8) !std.json.Value {
    return parent.get(key) orelse error.InvalidData;
}

pub fn requiredArray(parent: Object, key: []const u8) !Array {
    const value = try required(parent, key);
    return array(value);
}

pub fn requiredString(parent: Object, key: []const u8) ![]const u8 {
    const value = try required(parent, key);
    return string(value);
}

pub fn optionalString(parent: Object, key: []const u8) !?[]const u8 {
    const value = parent.get(key) orelse return null;
    return try string(value);
}
