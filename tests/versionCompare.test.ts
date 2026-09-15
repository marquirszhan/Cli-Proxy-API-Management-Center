import { describe, expect, test } from 'bun:test';
import { compareVersions, parseVersionSegments } from '@/utils/versionCompare';

describe('versionCompare', () => {
  test('parses caidaoli fork tags and dirty local versions', () => {
    expect(parseVersionSegments('fork/v8.89.0')).toEqual([8, 89, 0]);
    expect(parseVersionSegments('v8.88.0-dirty')).toEqual([8, 88, 0]);
  });

  test('does not treat official v7 as newer than caidaoli v8', () => {
    expect(compareVersions('v7.3.3', 'v8.88.0-dirty')).toBe(-1);
  });

  test('detects a newer caidaoli main-program release', () => {
    expect(compareVersions('fork/v8.89.0', 'v8.88.0-dirty')).toBe(1);
    expect(compareVersions('fork/v8.88.0', 'v8.88.0-dirty')).toBe(0);
  });
});
