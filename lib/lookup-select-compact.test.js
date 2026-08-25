import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFile } from "node:fs/promises"
import { LookupSelect } from "../components/LookupSelect.tsx"

const options = [
  { id: "1", code: "EA", name: "Example Activity" },
  { id: "2", code: "FB", name: "Finance B" },
]

function renderCompact(extraProps = {}) {
  return renderToStaticMarkup(
    createElement(LookupSelect, {
      compact: true,
      value: "",
      onChange: () => {},
      options,
      placeholder: "Select option",
      ...extraProps,
    }),
  )
}

test("compact select-only mode renders one dropdown and no search input", () => {
  const html = renderCompact({ compactSelectOnly: true })
  expect((html.match(/<select/g) || []).length).toBe(1)
  expect((html.match(/<input/g) || []).length).toBe(0)
})

test("normal compact mode keeps the existing search input and dropdown", () => {
  const html = renderCompact()
  expect((html.match(/<select/g) || []).length).toBe(1)
  expect((html.match(/<input/g) || []).length).toBe(1)
})

test("budget grid enables select-only mode only for Activity Ref, Finance Code, and Unit", async () => {
  const source = await readFile(new URL("../app/dashboard/budget-template/page.tsx", import.meta.url), "utf8")
  expect((source.match(/compactSelectOnly/g) || []).length).toBe(3)

  for (const placeholder of ["Select activity", "Search finance code", "Select unit"]) {
    const position = source.indexOf(`placeholder=\"${placeholder}\"`)
    expect(position).toBeGreaterThan(-1)
    const nearby = source.slice(Math.max(0, position - 500), position + 120)
    expect(nearby).toContain("compactSelectOnly")
  }
})
