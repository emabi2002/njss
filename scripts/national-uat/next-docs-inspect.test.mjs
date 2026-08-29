import fs from 'node:fs'
import path from 'node:path'

const root = 'node_modules/next/dist/docs'
if (!fs.existsSync(root)) throw new Error(`Missing installed Next.js docs at ${root}`)

const matches = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full)
    else if (/\.(md|mdx)$/.test(name) && /(client|component|data|fetch|mutation|form|route|app-router)/i.test(full)) matches.push(full)
  }
}
walk(root)
console.log('NEXT_DOC_MATCHES_START')
for (const file of matches.slice(0, 40)) console.log(file)
console.log('NEXT_DOC_MATCHES_END')
