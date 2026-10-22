/** Pure presentation helpers; server-side SQL remains the authority. */
export function normalizeItem(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}
export function tokenSimilarity(left, right) {
  const a=new Set(normalizeItem(left).split(' ').filter(Boolean))
  const b=new Set(normalizeItem(right).split(' ').filter(Boolean))
  if(!a.size || !b.size) return 0
  return [...a].filter(x=>b.has(x)).length / new Set([...a,...b]).size
}
export function rankDuplicateCandidates(item,candidates) {
  return candidates.map(candidate=>{
    const sameCode=Boolean(item.code && candidate.code &&
      normalizeItem(item.code)===normalizeItem(candidate.code))
    const exactName=normalizeItem(item.name)===normalizeItem(candidate.name)
    const score=sameCode?1:exactName?.95:tokenSimilarity(item.name,candidate.name)
    return {...candidate,score,reviewRequired:score>=.55}
  }).filter(x=>x.reviewRequired).sort((a,b)=>b.score-a.score)
}
