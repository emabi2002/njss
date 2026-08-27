from pathlib import Path

path = Path('app/dashboard/budget-template/page.tsx')
text = path.read_text()
old = '''  const { profile, can } = useAuth()
'''
new = '''  const { profile, roles, can } = useAuth()
'''
if old not in text:
    raise SystemExit('useAuth anchor not found')
text = text.replace(old, new, 1)

old = '''  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const canRevisionCreate = can("budget.revision.create")
  const canRevisionEdit = can("budget.revision.edit")
  const canRevisionSubmit = can("budget.revision.submit")
  const canRevisionReturn = can("budget.revision.return")
  const canRevisionReject = can("budget.revision.reject")
  const canRevisionApprove = can("budget.revision.approve")
'''
new = '''  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const isRegistrar = roles.includes("Registrar")
  const isLineSupervisor = roles.includes("Line Supervisor")
  const canRevisionCreate = isRegistrar && can("budget.revision.create")
  const canRevisionEdit = isLineSupervisor && can("budget.revision.edit")
  const canRevisionSubmit = isLineSupervisor && can("budget.revision.submit")
  const canRevisionReturn = isRegistrar && can("budget.revision.return")
  const canRevisionReject = isRegistrar && can("budget.revision.reject")
  const canRevisionApprove = isRegistrar && can("budget.revision.approve")
'''
if old not in text:
    raise SystemExit('revision permission anchor not found')
text = text.replace(old, new, 1)
path.write_text(text)
