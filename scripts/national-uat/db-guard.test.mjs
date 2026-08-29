import assert from 'node:assert/strict'
import { EXPECTED_PROJECT_REF } from './constants.ts'
import {
  projectRefFromUrl,
  assertProjectRef,
  assertExpectedProject,
} from './db.ts'

assert.equal(
  projectRefFromUrl('https://qzsmmalfeinoagvronpb.supabase.co'),
  EXPECTED_PROJECT_REF,
)
assert.equal(
  projectRefFromUrl('https://qzsmmalfeinoagvronpb.supabase.co/'),
  EXPECTED_PROJECT_REF,
)
assert.equal(projectRefFromUrl(''), '')

assert.throws(
  () => assertProjectRef('wrong-project'),
  /Refusing NJSS National UAT operation.*wrong-project.*qzsmmalfeinoagvronpb/,
)
assert.doesNotThrow(() => assertProjectRef(EXPECTED_PROJECT_REF))

assert.throws(
  () => assertExpectedProject({ NEXT_PUBLIC_SUPABASE_URL: 'https://another.supabase.co' }),
  /Refusing NJSS National UAT operation/,
)
assert.doesNotThrow(() => assertExpectedProject({
  NEXT_PUBLIC_SUPABASE_URL: 'https://qzsmmalfeinoagvronpb.supabase.co',
}))

console.log('national UAT database guard checks passed')
