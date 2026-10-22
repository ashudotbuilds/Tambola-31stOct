import { readFile, writeFile } from 'node:fs/promises'

// Each deploy folder owns its source and dependencies. Keep these intentionally
// mirrored contracts/rules identical without a cross-folder build dependency.
const names = ['types.ts', 'claims.ts', 'bank.ts']
const checking = process.argv.includes('--check')
for (const name of names) {
  const source = new URL(`../backend/src/shared/${name}`, import.meta.url)
  const target = new URL(`../frontend/src/shared/${name}`, import.meta.url)
  const canonical = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n')
  if (checking) {
    const copy = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n')
    if (copy !== canonical) throw new Error(`${name} differs; run npm run sync:shared`)
  } else {
    await writeFile(target, canonical)
  }
}
console.log(checking ? 'Shared contracts and rules match.' : 'Copied shared contracts and rules to frontend/.')
