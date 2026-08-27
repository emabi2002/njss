from pathlib import Path

path = Path('app/dashboard/budget-template/page.tsx')
text = path.read_text()
old = '''  const allocateEvenly = () => {
    const row = gridRows.find((item) => item.clientId === selectedRow)
    if (!row) return
    const estimate = annualEstimate(row)
    const perMonth = Math.floor((estimate / 12) * 100) / 100
    const months = Array.from({ length: 12 }, () => perMonth)
    months[11] = Number((months[11] + (estimate - months.reduce((sum, value) => sum + value, 0))).toFixed(2))
    updateRow(row.clientId, { months })
  }
'''
new = '''  const allocateEvenly = () => {
    const row = gridRows.find((item) => item.clientId === selectedRow)
    if (!row) return
    const estimate = annualEstimate(row)
    const lockedIndexes = revision
      ? MONTHS.map((_, index) => index).filter((index) => isRevisionMonthLocked(row, index))
      : []

    if (lockedIndexes.length > 0) {
      const unlockedIndexes = MONTHS.map((_, index) => index).filter((index) => !isRevisionMonthLocked(row, index))
      if (unlockedIndexes.length === 0) {
        setMessage({ type: "err", text: "All monthly periods on this revision line are locked by closed periods or actual expenditure." })
        return
      }

      const months = [...row.months]
      const lockedTotal = lockedIndexes.reduce((sum, index) => sum + Number(months[index] || 0), 0)
      const remainingEstimate = Number((estimate - lockedTotal).toFixed(2))
      if (remainingEstimate < -0.009) {
        setMessage({ type: "err", text: "The proposed annual estimate is below the amount already fixed in locked monthly periods." })
        return
      }

      const perOpenMonth = Math.floor((Math.max(remainingEstimate, 0) / unlockedIndexes.length) * 100) / 100
      unlockedIndexes.forEach((index) => { months[index] = perOpenMonth })
      const allocated = months.reduce((sum, value) => sum + Number(value || 0), 0)
      const finalOpenIndex = unlockedIndexes[unlockedIndexes.length - 1]
      months[finalOpenIndex] = Number((months[finalOpenIndex] + (estimate - allocated)).toFixed(2))
      updateRow(row.clientId, { months })
      return
    }

    const perMonth = Math.floor((estimate / 12) * 100) / 100
    const months = Array.from({ length: 12 }, () => perMonth)
    months[11] = Number((months[11] + (estimate - months.reduce((sum, value) => sum + value, 0))).toFixed(2))
    updateRow(row.clientId, { months })
  }
'''
if old not in text:
    raise SystemExit('allocateEvenly anchor not found')
path.write_text(text.replace(old, new, 1))
print('Safe revision Allocate Evenly behavior applied')
