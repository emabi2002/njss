-- Transactional migration check: all fixture rows are removed before commit.
do $test$
declare v_loc uuid; v_lang uuid; v_judge uuid; v_room uuid;
  v_interpreter uuid; v_attendant uuid; v_sitting uuid;
  v_rejected boolean := false;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',
    (select auth_user_id::text from court_interpreter.memberships
     where app_role='admin' and is_active limit 1), true);
  if (select auth.uid()) is null then raise exception 'No administrator for smoke check'; end if;
  select id into v_loc from public.court_locations where is_active limit 1;
  if v_loc is null then raise exception 'No active court location for smoke check'; end if;
  insert into court_interpreter.languages(name) values ('CI temporary smoke language')
    returning id into v_lang;
  insert into court_interpreter.judges(first_name,last_name) values ('CI','Smoke')
    returning id into v_judge;
  insert into court_interpreter.courtrooms(court_location_id,name)
    values (v_loc,'CI temporary smoke room') returning id into v_room;
  insert into court_interpreter.contacts(first_name,last_name,contact_type_id,engagement_type_id,court_location_id)
    values ('CI','Smoke Interpreter',1,1,v_loc) returning id into v_interpreter;
  insert into court_interpreter.contacts(first_name,last_name,contact_type_id,engagement_type_id,court_location_id)
    values ('CI','Smoke Attendant',2,1,v_loc) returning id into v_attendant;
  insert into court_interpreter.contact_languages(contact_id,language_id)
    values (v_interpreter,v_lang);
  select public.ci_add_sitting(current_date, '09:00'::time,'10:00'::time,
    v_room,v_lang,v_judge,v_interpreter,v_attendant) into v_sitting;
  if (select count(*) from court_interpreter.sitting_contacts where sitting_id=v_sitting) <> 2
     or (select count(*) from court_interpreter.sitting_judges where sitting_id=v_sitting) <> 1 then
    raise exception 'Booking links were not saved';
  end if;
  begin
    perform public.ci_add_sitting(current_date,'09:30'::time,'10:30'::time,
      v_room,v_lang,v_judge,v_interpreter,v_attendant);
  exception when others then
    if sqlerrm like '%already assigned%' then v_rejected := true;
    else raise; end if;
  end;
  if not v_rejected then raise exception 'Overlapping booking was accepted'; end if;
  delete from court_interpreter.court_sittings where id=v_sitting;
  delete from court_interpreter.contacts where id in (v_interpreter,v_attendant);
  delete from court_interpreter.courtrooms where id=v_room;
  delete from court_interpreter.judges where id=v_judge;
  delete from court_interpreter.languages where id=v_lang;
end $test$;
