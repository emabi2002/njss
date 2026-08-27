from pathlib import Path
import runpy

helper = Path('scripts/apply-budget-revision-ui.py')
text = helper.read_text()
old = '''            <HeaderCell label="Budget Ceiling" value={money(selected.budget_ceiling || 0)} strong />'''
new = '''            <HeaderCell label="Budget Ceiling" value={money(selected.budget_ceiling || 0)} />'''
if old not in text:
    raise SystemExit('expected helper anchor not found')
helper.write_text(text.replace(old, new, 1))
runpy.run_path(str(helper), run_name='__main__')
