-- Migration 002: Seed Standard Chart of Accounts & VTU Products

-- System Clearing & Escrow Accounts
INSERT INTO accounts (id, account_number, name, type, currency, is_active)
VALUES
    ('1010-GATEWAY-ESCROW', '1010', 'Payment Gateway Settlement Escrow', 'ASSET', 'NGN', TRUE),
    ('1090-SANDBOX-CASH', '1090', 'Sandbox Simulated Cash Asset', 'ASSET', 'NGN', TRUE),
    ('1020-PROVIDER-FLOAT:MOCK', '1020-MOCK', 'Mock Provider Pre-funded Float', 'ASSET', 'NGN', TRUE),
    ('1020-PROVIDER-FLOAT:VTPASS', '1020-VTPASS', 'VTPass Pre-funded Float', 'ASSET', 'NGN', TRUE),
    ('1020-PROVIDER-FLOAT:CLUBKONNECT', '1020-CLUBK', 'ClubKonnect Pre-funded Float', 'ASSET', 'NGN', TRUE),
    ('2090-SANDBOX-FUNDING', '2090', 'Sandbox Simulated Funding Liability', 'LIABILITY', 'NGN', TRUE),
    ('3010-ADMIN-CORRECTION', '3010', 'Admin Ledger Correction Account', 'EQUITY', 'NGN', TRUE),
    ('4010-VTU-COMMISSION', '4010', 'VTU Gross Sales Revenue', 'REVENUE', 'NGN', TRUE),
    ('4020-TRANSACTION-FEES', '4020', 'Platform Convenience Fees', 'REVENUE', 'NGN', TRUE),
    ('5010-VTU-COST-OF-GOODS', '5010', 'Wholesale Cost of VTU Fulfillment', 'EXPENSE', 'NGN', TRUE),
    ('5020-PAYMENT-GATEWAY-FEES', '5020', 'Aggregator Gateway Processing Fees', 'EXPENSE', 'NGN', TRUE),
    ('5030-OPERATIONAL-LOSS', '5030', 'Operational Loss & Write-offs', 'EXPENSE', 'NGN', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Seed Default VTU Catalog (Airtime & Common Data Bundles)
INSERT INTO vtu_products (id, service_type, operator, name, amount_kobo, cost_kobo, validity, is_active)
VALUES
    ('MTN_AIRTIME', 'airtime', 'MTN', 'MTN Airtime VTU (Flexible)', NULL, NULL, 'Instant', TRUE),
    ('GLO_AIRTIME', 'airtime', 'GLO', 'Glo Airtime VTU (Flexible)', NULL, NULL, 'Instant', TRUE),
    ('AIRTEL_AIRTIME', 'airtime', 'AIRTEL', 'Airtel Airtime VTU (Flexible)', NULL, NULL, 'Instant', TRUE),
    ('9MOBILE_AIRTIME', 'airtime', '9MOBILE', '9mobile Airtime VTU (Flexible)', NULL, NULL, 'Instant', TRUE),
    ('MTN_DATA_1GB_30D', 'data', 'MTN', 'MTN 1GB SME Data Bundle', 30000, 27000, '30 Days', TRUE),
    ('MTN_DATA_2GB_30D', 'data', 'MTN', 'MTN 2GB SME Data Bundle', 60000, 54000, '30 Days', TRUE),
    ('MTN_DATA_5GB_30D', 'data', 'MTN', 'MTN 5GB SME Data Bundle', 150000, 135000, '30 Days', TRUE),
    ('AIRTEL_DATA_1GB_30D', 'data', 'AIRTEL', 'Airtel 1GB Corporate Data Bundle', 32000, 28500, '30 Days', TRUE),
    ('GLO_DATA_1GB_30D', 'data', 'GLO', 'Glo 1GB Data Gift', 31000, 27500, '30 Days', TRUE)
ON CONFLICT (id) DO NOTHING;
