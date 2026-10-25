import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own throwaway data dir: tests never touch the real data/.
process.env.LQ_DATA_DIR = mkdtempSync(join(tmpdir(), 'lq-test-'));
