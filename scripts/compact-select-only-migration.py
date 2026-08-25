from pathlib import Path

# One-off migration used to prove the approved compact select-only behavior.
# Rerun after strengthening the grid assertion.
root = Path.cwd()
component_path = root / "components/LookupSelect.tsx"
page_path = root / "app/dashboard/budget-template/page.tsx"

component = component_path.read_text()
page = page_path.read_text()


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label}; found {count}")
    return source.replace(old, new, 1)

component = replace_once(
    component,
    "  compact?: boolean\n  className?: string\n",
    "  compact?: boolean\n  compactSelectOnly?: boolean\n  className?: string\n",
    "compactSelectOnly prop type",
)

component = replace_once(
    component,
    "  compact = false,\n  className = \"\",\n",
    "  compact = false,\n  compactSelectOnly = false,\n  className = \"\",\n",
    "compactSelectOnly prop default",
)

old_search = '''          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (!event.target.value) onChange("")
              }}
              disabled={disabled}
              placeholder={options.length === 0 ? unauthorizedEmptyLabel : placeholder}
              list={listId}
              className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
            />
            <datalist id={listId}>{filtered.map((option) => <option key={option.id} value={optionLabel(option)} />)}</datalist>
          </div>
'''

new_search = '''          {!compactSelectOnly && (
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (!event.target.value) onChange("")
                }}
                disabled={disabled}
                placeholder={options.length === 0 ? unauthorizedEmptyLabel : placeholder}
                list={listId}
                className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
              />
              <datalist id={listId}>{filtered.map((option) => <option key={option.id} value={optionLabel(option)} />)}</datalist>
            </div>
          )}
'''

component = replace_once(component, old_search, new_search, "compact search control")

for placeholder in ("Select activity", "Search finance code", "Select unit"):
    marker = f'                              placeholder="{placeholder}"\n'
    position = page.find(marker)
    if position < 0:
        raise RuntimeError(f"Could not find {placeholder} lookup")
    compact_position = page.rfind("                              compact\n", max(0, position - 500), position)
    if compact_position < 0:
        raise RuntimeError(f"Could not find compact prop before {placeholder}")
    insert_at = compact_position + len("                              compact\n")
    if page[insert_at:insert_at + len("                              compactSelectOnly\n")] == "                              compactSelectOnly\n":
        raise RuntimeError(f"{placeholder} already has compactSelectOnly")
    page = page[:insert_at] + "                              compactSelectOnly\n" + page[insert_at:]

if page.count("compactSelectOnly") != 3:
    raise RuntimeError(f"Expected exactly 3 compactSelectOnly usages; found {page.count('compactSelectOnly')}")

component_path.write_text(component)
page_path.write_text(page)
