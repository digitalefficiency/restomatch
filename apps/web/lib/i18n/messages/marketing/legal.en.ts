import type { Shape } from '../../translate';
import type { legalHe } from './legal.he';

/**
 * 'marketing.legal' — English rendering of the counsel-review draft.
 * The Hebrew version prevails; keep this a faithful translation.
 */
export const legalEn: Shape<typeof legalHe> = {
  shell: {
    bannerTitle: 'Draft for review by legal counsel',
    bannerBeforeTag:
      'This document is an initial skeleton only and is not legal advice. Every substantive sentence is marked with the tag',
    bannerAfterTag:
      'and must be verified, completed or replaced by a lawyer before binding publication. Do not rely on this wording as is.',
    prevailingVersion: 'This English version is provided for convenience; the Hebrew version prevails.',
    reviewTag: '[pending legal review]',
    lastUpdated: 'Last updated: {date}',
    related: 'Related documents:',
    linkPrivacy: 'Privacy Policy',
    linkTerms: 'Terms of Use',
    linkCookies: 'Cookie Policy',
    notSet: '—',
  },
  privacy: {
    metaTitle: 'Privacy Policy · RestoMatch',
    metaDescription:
      'What information RestoMatch collects, for what purposes, with whom it is shared, and how to exercise your rights.',
    title: 'Privacy Policy',
    intro: 'How RestoMatch collects, uses, shares and retains personal information — and how you can exercise your rights.',
    s1: {
      heading: '1. Identity of the database controller',
      c1: 'The controller of the database is the legal entity operating RestoMatch; its incorporation details, business registration number and registered address will be completed here',
      c2: 'Privacy inquiries can be sent to the contact address listed in the "Contact and Privacy Protection Officer" section below',
    },
    s2: {
      heading: '2. Categories of information we collect',
      c1: 'Account information: name, email address, phone number and the identification details required for sign-in and permission management',
      c2: 'Supplier and procurement information: supplier details, orders, catalogs and prices entered or uploaded by users',
      c3: 'Images and files of invoices and delivery notes, including the data extracted from them during automated reading',
      c4: 'Marketing lead information provided voluntarily through the contact form on the website',
      c5: 'Usage and technical information, such as activity logs, device data and technical identifiers required for security and operation of the service',
    },
    s3: {
      heading: '3. Purposes of use and legal basis',
      c1: 'We use the information to provide the service, to compare orders, goods receipts and invoices, and to alert on discrepancies',
      c2: 'We use the information for information security, fraud prevention, billing, support and improving the service',
      c3: 'The legal basis for each purpose — including performance of a contract, consent, legal obligation or legitimate interest — will be set out and reviewed here',
    },
    s4: {
      heading: '4. Service providers and third parties (sub-processors)',
      c1: 'We use service providers (sub-processors) to process information on our behalf; the table below lists the main ones and is kept up to date in the sub-processor register',
      c2: 'The countries, transfer mechanisms and status of the data processing agreements (DPA) are shown in the table as a draft and will be verified against the internal register',
      table: {
        provider: 'Service provider',
        purpose: 'Purpose',
        country: 'Country',
        dpa: 'DPA',
      },
      purpose: {
        supabase: 'Database, authentication and file storage',
        resend: 'Sending operational email',
        anthropic: 'Invoice reading (OCR/AI)',
        googleDocAi: 'Invoice reading (OCR)',
        upstash: 'Rate limiting and queues',
        vercel: 'Hosting the web application',
        fly: 'Hosting background services',
        sentry: 'Error monitoring',
        higgsfield: 'Producing marketing assets',
      },
      country: {
        unknown: '—',
        us: 'USA',
      },
      dpaStatus: {
        inReview: 'Under review',
      },
    },
    s5: {
      heading: '5. Transfer of information outside Israel',
      c1: 'Some service providers process information outside Israel, including the invoice-reading providers to which invoice images are sent',
      c2: 'The basis for transfer outside Israel, including the relevant contractual commitments, is documented in a dedicated transfer assessment and will be verified here',
    },
    s6: {
      heading: '6. Retention periods',
      c1: 'We retain information for as long as necessary for the purposes for which it was collected, and then delete or anonymize it',
      c2: 'Documents with accounting or tax significance may be retained for a longer period in accordance with applicable law, and the exact retention periods will be set out here',
    },
    s7: {
      heading: '7. Data subject rights',
      c1: 'Data subjects may have rights to access, rectify, erase and port the information collected about them',
      c2: 'Access, export and deletion requests can be made through the settings screen in the system, or by contacting the address below',
      accountPrefix: 'For account holders:',
      accountLink: 'Manage personal data and privacy requests',
    },
    s8: {
      heading: '8. Cookies',
      c1: 'We use essential cookies required for sign-in and the secure operation of the system, and non-essential cookies only after obtaining consent',
      detailsPrefix: 'Full details:',
      detailsLink: 'Cookie Policy',
    },
    s9: {
      heading: '9. Information security',
      c1: 'We take organizational and technical measures designed to protect the information against unauthorized access, use or disclosure',
    },
    s10: {
      heading: '10. Contact and Privacy Protection Officer',
      c1: 'Privacy questions, requests or complaints can be directed to the contact address and to the privacy protection officer, details of which will be provided here',
    },
  },
  terms: {
    metaTitle: 'Terms of Use · RestoMatch',
    metaDescription: 'The contractual terms for using the RestoMatch service.',
    title: 'Terms of Use',
    intro: 'The terms that apply to the use of RestoMatch. Using the service constitutes acceptance of these terms.',
    s1: {
      heading: '1. Description of the service',
      c1: 'RestoMatch provides a tool for restaurants to compare orders, goods receipts and invoices and to identify discrepancies in the procurement process',
      c2: 'We may update, expand or change the scope of the service from time to time, subject to applicable law',
    },
    s2: {
      heading: '2. The account and responsibility for it',
      c1: 'The user is responsible for keeping sign-in credentials confidential and for every action performed under their account',
      c2: 'The user undertakes to provide accurate and up-to-date information and to use the service in accordance with the law and these terms',
    },
    s3: {
      heading: '3. Permitted and prohibited use',
      c1: 'The service must not be misused, including attempting to bypass security controls, overloading the system or harming other users',
      c2: 'Do not upload unlawful content or content the user has no right to upload',
    },
    s4: {
      heading: '4. Payments and billing',
      c1: 'Billing terms, plans and prices are set out on the pricing page and may be updated subject to prior notice as required by law',
    },
    s5: {
      heading: '5. Intellectual property',
      c1: 'Intellectual property rights in the service, the code and the design are reserved to their owners; the user remains the owner of the data they enter',
    },
    s6: {
      heading: '6. Limitation of liability',
      c1: 'The service is provided as is; the scope of liability, exclusions and remedies will be defined here, subject to mandatory provisions of law',
    },
    s7: {
      heading: '7. Termination',
      c1: 'Either party may terminate the engagement in accordance with the terms to be set out here; upon termination the relevant data retention and deletion provisions will apply',
    },
    s8: {
      heading: '8. Governing law and jurisdiction',
      c1: 'These terms are governed by Israeli law, and jurisdiction will be determined here subject to legal review',
    },
    s9: {
      heading: '9. Changes to the terms',
      c1: 'We may update these terms from time to time; continued use after an update constitutes acceptance of the updated version, subject to law',
    },
  },
  cookies: {
    metaTitle: 'Cookie Policy · RestoMatch',
    metaDescription: 'Which cookies RestoMatch sets, for what purpose, and how to manage consent.',
    title: 'Cookie Policy',
    intro: 'Which cookies we set, for what purpose, and how you can control consent.',
    s1: {
      heading: '1. What are cookies',
      c1: 'Cookies are small files stored in the browser and used to operate the website, secure it and improve the user experience',
    },
    s2: {
      heading: '2. Types of cookies in use',
      c1: 'We set essential cookies required for sign-in and secure operation, and non-essential cookies (such as analytics) only after obtaining consent',
      table: {
        cookie: 'Cookie',
        purpose: 'Purpose',
        category: 'Category',
      },
      analyticsName: 'Analytics (future)',
      purpose: {
        session: 'Keeping the sign-in state (authenticated session)',
        csrf: 'Protection against request forgery (CSRF)',
        consent: 'Storing the cookie consent choice',
        analytics: 'Measuring usage and improving the product — enabled only after consent',
      },
      category: {
        essential: 'Essential',
        nonEssential: 'Non-essential',
      },
    },
    s3: {
      heading: '3. Managing consent',
      c1: 'You can accept or reject non-essential cookies using the consent banner, and change your choice at any time by deleting the consent cookie in your browser',
      c2: 'Blocking essential cookies may impair your ability to use the system or stay signed in',
    },
    s4: {
      heading: '4. More information',
      morePrefix: 'For details on the information we collect, see the',
      moreLink: 'Privacy Policy',
    },
  },
};
