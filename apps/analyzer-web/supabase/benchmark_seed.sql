insert into public.market_rent_benchmarks (
  region_code, region_label, property_type, bedrooms, sqft_band, year_built_band, period,
  median_rent, p25_rent, p75_rent, source_name, source_publisher, source_url, notes
)
values
  ('ca-on-gta', 'Greater Toronto Area, ON', 'apartment', 1, '600_899', null, '2025-Q1', 2500, 2300, 2800, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'apartment', 2, '900_1199', null, '2025-Q1', 3200, 2900, 3600, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'townhouse', 3, '1200_1599', null, '2025-Q1', 3550, 3250, 3950, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'house', 4, 'gte_1600', null, '2025-Q1', 4300, 3900, 4800, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'apartment', 1, '600_899', null, '2025-Q1', 2450, 2250, 2750, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'apartment', 2, '900_1199', null, '2025-Q1', 3050, 2800, 3400, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'townhouse', 3, '1200_1599', null, '2025-Q1', 3550, 3250, 3900, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'house', 3, '1200_1599', null, '2025-Q1', 2450, 2200, 2700, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'house', 3, '1200_1599', null, '2025-Q1', 2150, 1900, 2400, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'apartment', 2, '900_1199', null, '2025-Q1', 2150, 1950, 2400, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'apartment', 2, '900_1199', null, '2025-Q1', 2350, 2150, 2650, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'apartment', 2, '900_1199', null, '2025-Q1', 2400, 2200, 2700, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'duplex', 4, 'gte_1600', null, '2025-Q1', 3650, 3350, 4050, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed')
on conflict do nothing;

insert into public.vacancy_benchmarks (
  region_code, region_label, property_type, period, vacancy_pct, source_name, source_publisher, source_url, notes
)
values
  ('ca-on-gta', 'Greater Toronto Area, ON', 'apartment', '2025-Q1', 1.8, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'apartment', '2025-Q1', 1.2, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'house', '2025-Q1', 3.4, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'house', '2025-Q1', 4.2, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'apartment', '2025-Q1', 2.3, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Starter benchmark seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'apartment', '2025-Q1', 2.2, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'apartment', '2025-Q1', 1.4, 'CMHC Rental Market Report', 'CMHC', 'https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/market-reports/rental-market-report', 'Expanded seed')
on conflict do nothing;

insert into public.cost_benchmarks (
  region_code, region_label, cost_type, property_type, period, value_monthly, value_annual, source_name, source_publisher, source_url, notes
)
values
  ('ca-on-gta', 'Greater Toronto Area, ON', 'property_tax', null, '2025-Q1', null, 4300, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'insurance', null, '2025-Q1', 125, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'utilities', null, '2025-Q1', 210, null, 'Utility bill averages', 'Public utility reports', 'https://www.hydroone.com/', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'maintenance_pct', null, '2025-Q1', 5.5, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Starter benchmark seed'),
  ('ca-on-gta', 'Greater Toronto Area, ON', 'management_fee_pct', null, '2025-Q1', 8.0, null, 'Property management benchmark', 'Industry survey', 'https://www.investopedia.com/', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'property_tax', null, '2025-Q1', null, 3550, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'insurance', null, '2025-Q1', 120, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'utilities', null, '2025-Q1', 200, null, 'Utility bill averages', 'Public utility reports', 'https://www.bchydro.com/', 'Starter benchmark seed'),
  ('ca-bc-vancouver', 'Metro Vancouver, BC', 'maintenance_pct', null, '2025-Q1', 5.2, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Starter benchmark seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'property_tax', null, '2025-Q1', null, 3700, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Starter benchmark seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'insurance', null, '2025-Q1', 110, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Starter benchmark seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'utilities', null, '2025-Q1', 220, null, 'Utility bill averages', 'Public utility reports', 'https://www.enmax.com/', 'Starter benchmark seed'),
  ('ca-ab-calgary', 'Calgary, AB', 'maintenance_pct', null, '2025-Q1', 5.8, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Starter benchmark seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'property_tax', null, '2025-Q1', null, 3300, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Expanded seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'insurance', null, '2025-Q1', 105, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Expanded seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'utilities', null, '2025-Q1', 210, null, 'Utility bill averages', 'Public utility reports', 'https://www.epcor.com/', 'Expanded seed'),
  ('ca-ab-edmonton', 'Edmonton, AB', 'maintenance_pct', null, '2025-Q1', 5.9, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Expanded seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'property_tax', null, '2025-Q1', null, 3400, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Starter benchmark seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'insurance', null, '2025-Q1', 105, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Starter benchmark seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'utilities', null, '2025-Q1', 190, null, 'Utility bill averages', 'Public utility reports', 'https://www.hydroquebec.com/', 'Starter benchmark seed'),
  ('ca-qc-montreal', 'Montreal, QC', 'maintenance_pct', null, '2025-Q1', 5.3, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Starter benchmark seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'property_tax', null, '2025-Q1', null, 3900, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Expanded seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'insurance', null, '2025-Q1', 115, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Expanded seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'utilities', null, '2025-Q1', 200, null, 'Utility bill averages', 'Public utility reports', 'https://hydroottawa.com/', 'Expanded seed'),
  ('ca-on-ottawa', 'Ottawa, ON', 'maintenance_pct', null, '2025-Q1', 5.2, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'property_tax', null, '2025-Q1', null, 3200, 'Municipal tax aggregates + CMHC', 'Municipal/CMHC', 'https://www.cmhc-schl.gc.ca/', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'insurance', null, '2025-Q1', 110, null, 'Insurance market averages', 'Ratehub/Public reports', 'https://www.ratehub.ca/', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'utilities', null, '2025-Q1', 190, null, 'Utility bill averages', 'Public utility reports', 'https://www.bchydro.com/', 'Expanded seed'),
  ('ca-bc-victoria', 'Greater Victoria, BC', 'maintenance_pct', null, '2025-Q1', 5.1, null, 'Property operations benchmark', 'Industry rule-of-thumb', 'https://www.investopedia.com/', 'Expanded seed')
on conflict do nothing;
