/** Client-side preview helpers. PostgreSQL permission-checked transactions are authoritative. */
export function validateLinkedPurchase({ approvedQuantity, orderedQuantity, requestedQuantity }) {
  for (const [name, raw] of Object.entries({ approvedQuantity, orderedQuantity, requestedQuantity })) {
    if (!Number.isFinite(Number(raw))) throw new RangeError(`${name} must be numeric`)
  }
  const approved = Number(approvedQuantity)
  const alreadyOrdered = Number(orderedQuantity)
  const requested = Number(requestedQuantity)
  if (approved < 0 || alreadyOrdered < 0 || requested <= 0) return { allowed: false, reason: 'Invalid quantity' }
  if (alreadyOrdered + requested > approved + 1e-8) return { allowed: false, reason: 'Requested quantity exceeds remaining approval' }
  return { allowed: true, remaining: Math.max(0, approved - alreadyOrdered - requested) }
}
export function validateGoodsReceipt({ orderedQuantity, receivedSoFar, newReceipt }) {
  const [ordered,received,newQty] = [orderedQuantity, receivedSoFar, newReceipt].map(Number)
  if (![ordered, received, newQty].every(Number.isFinite) || ordered < 0 || received < 0 || newQty <= 0) return false
  return received + newQty <= ordered + 1e-8
}
export function mayVerifyEvidence({ verifierId, recorderId, status, reason }) {
  return Boolean(verifierId && recorderId && verifierId !== recorderId &&
    status === 'REPORTED' && String(reason ?? '').trim().length >= 8)
}
