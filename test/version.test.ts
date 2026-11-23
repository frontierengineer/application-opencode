import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeVersion } from '../src/version.ts';

test('a version is usable from the minimum up to the next major version, and one that does not say its version is not', () => {
  assert.deepEqual(judgeVersion('0.108.0', '0.108.0'), { usable: true });
  assert.deepEqual(judgeVersion('0.108.3', '0.108.0'), { usable: true });
  assert.deepEqual(judgeVersion('0.120.0', '0.108.0'), { usable: true });
  assert.deepEqual(judgeVersion('opencode 1.20.1\n', '1.19.6'), { usable: true });
  assert.deepEqual(judgeVersion('0.107.9', '0.108.0'), { usable: false, why: 'older' });
  assert.deepEqual(judgeVersion('1.19.5', '1.19.6'), { usable: false, why: 'older' });
  assert.deepEqual(judgeVersion('0.200.0', '1.19.6'), { usable: false, why: 'older' });
  assert.deepEqual(judgeVersion('2.0.0', '1.19.6'), { usable: false, why: 'newer_major' });
  assert.deepEqual(judgeVersion(null, '1.19.6'), { usable: false, why: 'unknown' });
  assert.deepEqual(judgeVersion('dev', '1.19.6'), { usable: false, why: 'unknown' });
});
