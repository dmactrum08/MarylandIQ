-- Patch: fix broken county_board_url values
-- Sourced from Maryland State Board of Elections directory (elections.maryland.gov/about/county_boards.html)
-- Verified 200 responses April 2026. Re-verify before next election cycle.
-- Note: PG County (403) and St. Mary's (timeout) respond to browsers but block curl.

UPDATE jurisdictions SET county_board_url = 'https://www.alleganygov.org/158/Election-Office'
  WHERE slug = 'allegany-county';

UPDATE jurisdictions SET county_board_url = 'https://www.aacounty.org/boards-and-commissions/board-of-elections/'
  WHERE slug = 'anne-arundel-county';

UPDATE jurisdictions SET county_board_url = 'https://boe.baltimorecity.gov'
  WHERE slug = 'baltimore-city';

UPDATE jurisdictions SET county_board_url = 'https://www.baltimorecountymd.gov/Agencies/elections/index.html'
  WHERE slug = 'baltimore-county';

UPDATE jurisdictions SET county_board_url = 'https://elections.carrollcountymd.gov'
  WHERE slug = 'carroll-county';

UPDATE jurisdictions SET county_board_url = 'https://www.cecilcountymd.gov/170/Board-of-Elections'
  WHERE slug = 'cecil-county';

UPDATE jurisdictions SET county_board_url = 'https://www.docomdelections.org/'
  WHERE slug = 'dorchester-county';

UPDATE jurisdictions SET county_board_url = 'https://www.frederickcountymd.gov/elections'
  WHERE slug = 'frederick-county';

UPDATE jurisdictions SET county_board_url = 'https://www.harfordcountymd.gov/153/Board-of-Elections'
  WHERE slug = 'harford-county';

UPDATE jurisdictions SET county_board_url = 'https://www.howardcountymd.gov/board-elections'
  WHERE slug = 'howard-county';

UPDATE jurisdictions SET county_board_url = 'https://www.kentcountyelections.org'
  WHERE slug = 'kent-county';

UPDATE jurisdictions SET county_board_url = 'https://www.montgomerycountymd.gov/elections/'
  WHERE slug = 'montgomery-county';

UPDATE jurisdictions SET county_board_url = 'https://www.princegeorgescountymd.gov/559/Board-of-Elections'
  WHERE slug = 'prince-georges-county';

UPDATE jurisdictions SET county_board_url = 'https://www.qacelections.com/'
  WHERE slug = 'queen-annes-county';

UPDATE jurisdictions SET county_board_url = 'https://www.stmaryscountymd.gov/supervisorofelections/'
  WHERE slug = 'st-marys-county';

UPDATE jurisdictions SET county_board_url = 'https://www.talbotcountymd.gov/index.php?page=Election_Board'
  WHERE slug = 'talbot-county';

UPDATE jurisdictions SET county_board_url = 'https://www.washco-mdelections.org/'
  WHERE slug = 'washington-county';

UPDATE jurisdictions SET county_board_url = 'https://www.wicomicocounty.org/285/Board-of-Elections'
  WHERE slug = 'wicomico-county';
