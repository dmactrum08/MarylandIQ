-- Add legislative portal URL to jurisdictions (county council agendas, votes, videos)
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS legislative_portal_url text;

-- Sourced from docs/maryland_jurisdiction_calendars.csv
UPDATE jurisdictions SET legislative_portal_url = 'https://www.alleganygov.org/454/Agendas-Minutes'                                    WHERE slug = 'allegany-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.aacounty.org/county-council/meetings'                                    WHERE slug = 'anne-arundel-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://baltimore.legistar.com/Calendar.aspx'                                        WHERE slug = 'baltimore-city';
UPDATE jurisdictions SET legislative_portal_url = 'https://countycouncil.baltimorecountymd.gov/legislative-session-agendas/'           WHERE slug = 'baltimore-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.calvertcountymd.gov/AgendaCenter'                                        WHERE slug = 'calvert-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.carolinemd.org/AgendaCenter'                                             WHERE slug = 'caroline-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.carrollcountymd.gov/government/upcoming-meetings-agendas-and-public-hearings/' WHERE slug = 'carroll-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.cecilcountymd.gov/129/Agendas-Minutes'                                   WHERE slug = 'cecil-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.charlescountymd.gov/government/board-of-charles-county-commissioners'    WHERE slug = 'charles-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://dorchestercountymd.com/county-council/'                                      WHERE slug = 'dorchester-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.frederickcountymd.gov/calendar.aspx?CID=80'                              WHERE slug = 'frederick-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.garrettcounty.org/commissioners/meetings'                                WHERE slug = 'garrett-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.harfordcountymd.gov/221/County-Council'                                  WHERE slug = 'harford-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://cc.howardcountymd.gov/Meetings-Events'                                       WHERE slug = 'howard-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.kentcounty.com/commissioners/meeting-agenda'                             WHERE slug = 'kent-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.montgomerycountymd.gov/COUNCIL/calendar.html'                            WHERE slug = 'montgomery-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://princegeorgescountymd.legistar.com/Calendar.aspx'                            WHERE slug = 'prince-georges-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.qac.org/AgendaCenter'                                                    WHERE slug = 'queen-annes-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.somersetmd.us/commissioners/agendas.html'                               WHERE slug = 'somerset-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.stmaryscountymd.gov/bocc/'                                               WHERE slug = 'saint-marys-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://talbotcountymd.gov/About-Us/County_Council/agendas/'                         WHERE slug = 'talbot-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.washco-md.net/county-commissioners/bocc-agendas-and-minutes/'            WHERE slug = 'washington-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://www.wicomicocounty.org/AgendaCenter'                                         WHERE slug = 'wicomico-county';
UPDATE jurisdictions SET legislative_portal_url = 'https://co.worcester.md.us/commissioners/agendas'                                    WHERE slug = 'worcester-county';
