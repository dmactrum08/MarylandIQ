-- MarylandIQ — Seed: Maryland's 24 County Jurisdictions
-- Run this AFTER schema.sql.
-- Source: Maryland State Board of Elections — 23 counties + Baltimore City.
-- county_board_url values sourced from each jurisdiction's official board of elections site.

INSERT INTO jurisdictions (slug, name, type, county_board_url) VALUES
    ('allegany-county',        'Allegany County',        'county', 'https://www.alleganygov.org/230/Board-of-Elections'),
    ('anne-arundel-county',    'Anne Arundel County',    'county', 'https://www.aacounty.org/boards-offices/board-of-elections'),
    ('baltimore-city',         'Baltimore City',          'city',   'https://bcelections.org'),
    ('baltimore-county',       'Baltimore County',        'county', 'https://boe.baltimorecountymd.gov'),
    ('calvert-county',         'Calvert County',          'county', 'https://www.calvertcountymd.gov/202/Board-of-Elections'),
    ('caroline-county',        'Caroline County',         'county', 'https://www.carolinemd.org/237/Board-of-Elections'),
    ('carroll-county',         'Carroll County',          'county', 'https://www.carrollcountymd.gov/government/departments/board-of-elections/'),
    ('cecil-county',           'Cecil County',            'county', 'https://www.ccgov.org/government/board-of-elections'),
    ('charles-county',         'Charles County',          'county', 'https://www.charlescountymd.gov/government/board-of-elections'),
    ('dorchester-county',      'Dorchester County',       'county', 'https://www.docogonet.com/departments/board-of-elections/'),
    ('frederick-county',       'Frederick County',        'county', 'https://www.frederickcountymd.gov/154/Board-of-Elections'),
    ('garrett-county',         'Garrett County',          'county', 'https://www.garrettcounty.org/board-of-elections'),
    ('harford-county',         'Harford County',          'county', 'https://www.harfordcountymd.gov/2188/Board-of-Elections'),
    ('howard-county',          'Howard County',           'county', 'https://www.howardcountymd.gov/elections'),
    ('kent-county',            'Kent County',             'county', 'https://www.kentgov.org/231/Board-of-Elections'),
    ('montgomery-county',      'Montgomery County',       'county', 'https://www.montgomerymd.gov/elections'),
    ('prince-georges-county',  'Prince George''s County', 'county', 'https://www.princegeorgescountymd.gov/1410/Board-of-Elections'),
    ('queen-annes-county',     'Queen Anne''s County',    'county', 'https://www.qac.org/1149/Board-of-Elections'),
    ('saint-marys-county',     'Saint Mary''s County',    'county', 'https://www.stmarysmd.com/boe/'),
    ('somerset-county',        'Somerset County',         'county', 'https://www.somersetmd.us/government/boards-commissions/board-of-elections/'),
    ('talbot-county',          'Talbot County',           'county', 'https://www.talbotcountymd.gov/index.php?page=board_of_elections'),
    ('washington-county',      'Washington County',       'county', 'https://www.washco-md.net/board-of-elections/'),
    ('wicomico-county',        'Wicomico County',         'county', 'https://www.wicomicocounty.org/292/Board-of-Elections'),
    ('worcester-county',       'Worcester County',        'county', 'https://www.co.worcester.md.us/departments/board-elections/')
ON CONFLICT (slug) DO NOTHING;
