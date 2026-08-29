import { supabase } from "@/lib/supabase"

export type CourtLocationType =
  | "HEADQUARTERS"
  | "NATIONAL_COURT_REGISTRY"
  | "NATIONAL_COURT_SUB_REGISTRY"

export type ProvinceOption = {
  id: string
  code: string
  name: string
}

export type CourtLocationRow = {
  id: string
  province_id: string
  code: string
  name: string
  location_type: CourtLocationType
  town: string | null
  is_headquarters: boolean
  is_active: boolean
  province: ProvinceOption | null
}

export type CourtLocationInput = {
  province_id: string
  code: string
  name: string
  location_type: CourtLocationType
  town: string
}

export const COURT_LOCATION_TYPE_OPTIONS: readonly {
  value: CourtLocationType
  label: string
}[] = [
  { value: "HEADQUARTERS", label: "Headquarters" },
  { value: "NATIONAL_COURT_REGISTRY", label: "National Court Registry" },
  { value: "NATIONAL_COURT_SUB_REGISTRY", label: "National Court Sub-Registry" },
] as const

export function courtLocationTypeLabel(value: CourtLocationType): string {
  return COURT_LOCATION_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function normalizedInput(input: CourtLocationInput) {
  return {
    province_id: input.province_id,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    location_type: input.location_type,
    town: input.town.trim() || null,
    is_headquarters: input.location_type === "HEADQUARTERS",
  }
}

export async function listActiveProvinces(): Promise<ProvinceOption[]> {
  const { data, error } = await supabase
    .from("provinces")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name")

  if (error) throw error
  return (data || []) as ProvinceOption[]
}

export async function listCourtLocations(): Promise<CourtLocationRow[]> {
  const { data, error } = await supabase
    .from("court_locations")
    .select("id, province_id, code, name, location_type, town, is_headquarters, is_active, province:provinces(id, code, name)")
    .order("code")

  if (error) throw error
  return (data || []) as unknown as CourtLocationRow[]
}

export async function createCourtLocation(input: CourtLocationInput): Promise<CourtLocationRow> {
  const { data, error } = await supabase
    .from("court_locations")
    .insert({ ...normalizedInput(input), is_active: true })
    .select("id, province_id, code, name, location_type, town, is_headquarters, is_active, province:provinces(id, code, name)")
    .single()

  if (error) throw error
  return data as unknown as CourtLocationRow
}

export async function updateCourtLocation(id: string, input: CourtLocationInput): Promise<CourtLocationRow> {
  const { data, error } = await supabase
    .from("court_locations")
    .update(normalizedInput(input))
    .eq("id", id)
    .select("id, province_id, code, name, location_type, town, is_headquarters, is_active, province:provinces(id, code, name)")
    .single()

  if (error) throw error
  return data as unknown as CourtLocationRow
}

export async function setCourtLocationActive(id: string, isActive: boolean): Promise<CourtLocationRow> {
  const { data, error } = await supabase
    .from("court_locations")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, province_id, code, name, location_type, town, is_headquarters, is_active, province:provinces(id, code, name)")
    .single()

  if (error) throw error
  return data as unknown as CourtLocationRow
}

export async function deleteCourtLocation(id: string): Promise<void> {
  const { error } = await supabase.from("court_locations").delete().eq("id", id)
  if (error) throw error
}
