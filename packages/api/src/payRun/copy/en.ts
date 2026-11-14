import type { CopyKey } from './he';

/** AU-14 English copy (server side). Partner wording: "credit request", never a demand or claim. */
export const en: Record<CopyKey, string> = {
  'preflight.title': 'Check before paying',
  'preflight.reason.possible_duplicate': 'Possible duplicate: similar to {otherNumber} from {otherDate} ({otherTotal}, {otherSource})',
  'preflight.reason.confirmed_copy': 'A copy of an invoice paid or to be paid · do not pay',
  'preflight.reason.first_payment': 'First payment to this supplier · check the bank details',
  'preflight.reason.bank_changed':
    "{supplierName}'s bank details changed on {changedOn} (account …{accountLast4}) · confirm by phone with the supplier before paying",
  'preflight.reason.unusual_amount': 'Unusual amount: {ratio}× the usual for this supplier (median {median})',
  'preflight.ack.possible_duplicate': 'Checked: possible duplicate of {otherNumber}',
  'preflight.ack.unusual_amount': 'Checked: the unusual amount is right',
  'preflight.ack.first_payment': "Checked: a new supplier's bank details",
  'preflight.release.confirm':
    "I confirmed with the supplier by phone, on the number in the supplier's card (not one from the invoice or the e-mail)",
  'preflight.source.photo': 'photographed',
  'preflight.source.email': 'sent by e-mail',
  'preflight.source.platform': 'from the platform',
  'preflight.source.manual': 'entered by hand',
  'preflight.source.whatsapp': 'sent on WhatsApp',
  'remit.greeting': 'Hello {supplierName},',
  'remit.paidIntro': 'On {paidOn} we paid these invoices:',
  'remit.paidLine': '• Invoice {invoiceNumber} · {amount}',
  'remit.offset': 'Offset: {amount} · credit request {claimNo} · {reason}',
  'remit.inReview': 'Invoice {invoiceNumber} is in review · we will update you',
  'remit.net': 'Total transferred: {amount}',
  'remit.thanks': 'Thank you,',
  'remit.noNumber': 'no number',
};
