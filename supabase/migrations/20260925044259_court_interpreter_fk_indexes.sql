-- Index foreign keys used by CourtInterpretor lookups and joins.
create index contact_bank_accounts_bank_idx on court_interpreter.contact_bank_accounts(bank_id);
create index contact_languages_language_idx on court_interpreter.contact_languages(language_id);
create index contacts_engagement_idx on court_interpreter.contacts(engagement_type_id);
create index contacts_province_idx on court_interpreter.contacts(province_id) where province_id is not null;
create index court_sittings_location_idx on court_interpreter.court_sittings(court_location_id);
create index court_sittings_language_idx on court_interpreter.court_sittings(language_id);
create index court_sittings_room_location_idx on court_interpreter.court_sittings(courtroom_id,court_location_id);
create index sitting_contacts_contact_type_idx on court_interpreter.sitting_contacts(contact_id,contact_type_id);
create index sitting_contacts_contact_language_idx on court_interpreter.sitting_contacts(contact_id,language_id);
create index sitting_contacts_language_idx on court_interpreter.sitting_contacts(language_id) where language_id is not null;
