import fs from 'node:fs'
import path from 'node:path'

const root = 'node_modules/next/dist/docs'
if (!fs.existsSync(root)) throw new Error(`Missing installed Next.js docs at ${root}`)

const wanted = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full)
    else if (/\.(md|mdx)$/.test(name) && /(forms\.md$|data-security\.md$|server-and-client-components\.md$)/i.test(full)) wanted.push(full)
  }
}
walk(root)
if (wanted.length < 2) throw new Error(`Could not locate required installed Next.js guides: ${wanted.join(', ')}`)
for (const file of wanted) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').slice(0, 220)
  console.log(`NEXT_DOC_START ${file}`)
  console.log(lines.join('\n'))
  console.log(`NEXT_DOC_END ${file}`)
}
