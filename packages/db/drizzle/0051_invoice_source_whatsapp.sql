-- 0051_invoice_source_whatsapp (S13): invoices registered from a WhatsApp message carry
-- source = 'whatsapp' (e-mail ingestion uses the existing 'email'). ADD VALUE lives alone
-- in its own file (it cannot be used in the transaction that adds it).
ALTER TYPE "invoice_source" ADD VALUE IF NOT EXISTS 'whatsapp';
