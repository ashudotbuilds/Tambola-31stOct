import test from 'node:test'
import assert from 'node:assert/strict'
import { MarkSaver, type MarkSaveStatus } from '../src/lib/markSaver'

test('fifteen rapid marks become one save of the final snapshot', async () => {
  const writes: number[][] = [], statuses: MarkSaveStatus[] = []
  const saver = new MarkSaver({ send: async n => { writes.push(n) }, online: () => true,
    status: s => statuses.push(s), saved: () => {} })
  try {
    for (let n = 1; n <= 15; n++) saver.update(Array.from({ length: n }, (_, i) => i + 1))
    await saver.flush()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].length, 15)
    assert.equal(statuses.at(-1), 'saved')
  } finally { saver.dispose() }
})

test('taps during an in-flight save coalesce into one ordered follow-up', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const writes: number[][] = []
  const saver = new MarkSaver({ send: async n => { writes.push(n); if (writes.length === 1) await held },
    online: () => true, status: () => {}, saved: () => {} })
  try {
    saver.update([1]); const flight = saver.flush()
    saver.update([1, 2]); saver.update([1, 2, 3])
    release(); await flight
    assert.deepEqual(writes, [[1], [1, 2, 3]])
  } finally { saver.dispose() }
})

test('offline and failed saves retain the latest marks for reconnect', async () => {
  let online = false, fail = true
  const saved: number[][] = [], statuses: MarkSaveStatus[] = []
  const saver = new MarkSaver({ send: async n => { if (fail) throw new Error('network'); saved.push(n) },
    online: () => online, status: s => statuses.push(s), saved: () => {} })
  try {
    saver.update([7]); await assert.rejects(saver.flush()); assert.equal(statuses.at(-1), 'offline')
    online = true; await assert.rejects(saver.flush()); assert.equal(statuses.at(-1), 'retrying')
    saver.update([7, 8]); fail = false; await saver.flush()
    assert.deepEqual(saved, [[7, 8]])
    assert.equal(statuses.at(-1), 'saved')
  } finally { saver.dispose() }
})
