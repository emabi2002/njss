from pathlib import Path

page_path = Path("app/dashboard/budget-template/page.tsx")
source = page_path.read_text()

for placeholder in ("Select priority", "Select method", "Select officer"):
    marker = f'                              placeholder="{placeholder}"\n'
    position = source.find(marker)
    if position < 0:
        raise RuntimeError(f"Could not find lookup for {placeholder}")

    compact_position = source.rfind("                              compact\n", max(0, position - 500), position)
    if compact_position < 0:
        raise RuntimeError(f"Could not find compact prop before {placeholder}")

    insert_at = compact_position + len("                              compact\n")
    prop = "                              compactSelectOnly\n"
    if source[insert_at:insert_at + len(prop)] != prop:
        source = source[:insert_at] + prop + source[insert_at:]

count = source.count("compactSelectOnly")
if count != 6:
    raise RuntimeError(f"Expected exactly 6 compactSelectOnly usages; found {count}")

page_path.write_text(source)
