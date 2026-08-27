from pathlib import Path

path = Path('app/dashboard/budget-template/page.tsx')
text = path.read_text()
old = '''                history={revisionHistory}
                currentAuthoritative={Boolean(selected.status === "APPROVED" && !selected.superseded_by_id)}
              />'''
new = '''                history={revisionHistory}
                currentAuthoritative={Boolean(selected.status === "APPROVED" && !selected.superseded_by_id)}
                proposedTotal={totalProposed}
              />'''
if old not in text:
    raise SystemExit('BudgetRevisionPanel prop anchor not found')
path.write_text(text.replace(old, new, 1))
print('Live revision summary total wired')
