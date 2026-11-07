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
      'Who operates RestoMatch, what information is processed, which service providers receive it and in which countries, and how to exercise your rights.',
    title: 'Privacy Policy',
    intro: 'Who we are, what information we process, where and with whom, how long it is kept — and how you can exercise your rights.',
    operatorPending: 'Operator name — to be completed',
    s1: {
      heading: '1. Who we are and our role',
      c1: 'RestoMatch is operated by {operator}. Privacy inquiries: {email}',
      c2: 'We are the database controller only for information about website visitors, people who submitted the contact form, account security and billing',
      c3: 'For the information a customer restaurant enters into the system — about its staff, suppliers, orders and invoices — the restaurant is the controller and we are the holder: we process that information on its behalf and on its instructions, under a data processing agreement with it',
    },
    s2: {
      heading: '2. Categories of information',
      c1: 'Account information: name, role, email address, phone number, interface language and the identification details required for sign-in and permission management',
      c2: 'Supplier and procurement information: supplier details and their contact people, orders, catalogs and prices entered or uploaded by users',
      c3: 'Images of invoices and delivery notes, and the data extracted from them by automated reading',
      c4: 'Details provided voluntarily through the contact form on the website, and how you reached the site (for example a campaign), which is kept in the browser until the tab is closed and sent with the form',
      c5: 'Activity logs and technical identifiers required to secure and operate the service',
    },
    s3: {
      heading: '3. Purposes of use',
      c1: 'We use the information to provide the service: matching order, goods receipt and invoice, showing discrepancies, running approvals and supplier credit claims, and sending operational alerts',
      c2: 'We also use information to secure the system, for billing and for support. A customer restaurant\'s information is used for nothing else; product improvement uses only aggregate data, and only with the restaurant\'s consent',
      c3: 'The legal basis for each purpose (performance of a contract, consent, legal obligation) is under review and will be set out here',
    },
    s4: {
      heading: '4. Service providers (sub-processors)',
      c1: 'We use only four service providers. Each receives only the information its role requires',
      c2: 'Reading invoices and delivery notes (OCR) is done by Anthropic: the document image is sent to it to be read. Anthropic is also used to translate the receiving screen for staff and to answer questions in the in-app assistant',
      c3: 'The data processing agreements (DPAs) with these providers are under review, so they are marked "In review"',
      table: {
        provider: 'Provider',
        purpose: 'Purpose',
        country: 'Country',
        dpa: 'DPA',
      },
      purpose: {
        supabase: 'Database, sign-in and storage of document images',
        vercel: 'Running the website and app, and operational logs',
        anthropic: 'Reading invoices and delivery notes (OCR), receiving-screen translation and the assistant',
        resend: 'Operational email (sign-in links, alerts)',
      },
      country: {
        japan: 'Japan (Tokyo)',
        japanEdge: 'Japan (Tokyo) + global edge network',
        us: 'USA',
      },
      dpaStatus: {
        inReview: 'In review',
      },
    },
    s5: {
      heading: '5. Transfers outside Israel',
      c1: 'Information is processed outside Israel: in Japan (Supabase, Vercel) and in the USA (Anthropic, Resend). Vercel also serves the website through a global edge network',
      c2: 'The transfer relies on the Privacy Protection (Transfer of Data to Databases Abroad) Regulations, 2001: the controller\'s consent, and each provider\'s written undertaking to protect the information and not pass it on. This basis is under review',
    },
    s6: {
      heading: '6. How long information is kept',
      c1: 'Account information is kept while the account is active',
      c2: 'Contact-form details: the proposed retention periods are about 30 days after consent is withdrawn, and about two years if no marketing consent was given. Automatic deletion is not active yet; until it is, we delete on request',
      c3: 'A customer restaurant\'s information: when the engagement ends, on request we hand over the document images and the data as CSV files within 14 days, and delete the information within 30 days. Copies in backups are deleted when the backup cycle ends',
      c4: 'Keeping invoices and documents as tax law requires is the restaurant\'s duty',
    },
    s7: {
      heading: '7. Your rights',
      c1: 'You may review the information about you and ask to correct or delete it',
      c2: 'Staff or suppliers of a customer restaurant should contact the restaurant first, as it is the controller of their information. A request that reaches us will be passed to the restaurant, and we will help it handle the request',
      c3: 'For any other request, write to {email}',
      accountPrefix: 'Account holders:',
      accountLink: 'Manage personal data and privacy requests',
    },
    s8: {
      heading: '8. Cookies and browser storage',
      c1: 'We use only the cookies and browser storage needed for sign-in, security, language and working in the system. There are currently no analytics or advertising cookies',
      detailsPrefix: 'Full details:',
      detailsLink: 'Cookie Policy',
    },
    s9: {
      heading: '9. Information security',
      c1: 'Each restaurant\'s information is separated at the database level (Row-Level Security); document images are kept in private storage and opened only through short-lived signed links; passwords are stored as argon2id hashes; traffic is encrypted (TLS); and two-step verification can be turned on',
      c2: 'Support access to a restaurant\'s information happens only through the admin console and is logged',
    },
    s10: {
      heading: '10. Contact',
      c1: 'Privacy inquiries: {operator} · {email}',
      c2: 'You may also contact the Privacy Protection Authority',
    },
  },
  terms: {
    metaTitle: 'Terms of Use · RestoMatch',
    metaDescription: 'The contractual terms for using the RestoMatch service.',
    title: 'Terms of Use',
    intro: 'The terms that apply to using RestoMatch. Using the service constitutes acceptance of these terms.',
    pilotNote: 'For pilot customers: the signed pilot agreement prevails over these terms',
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
    metaDescription: 'Which cookies and browser data RestoMatch stores, for what purpose and for how long.',
    title: 'Cookie Policy',
    intro: 'Which cookies and data we store in your browser, for what purpose and for how long.',
    s1: {
      heading: '1. What cookies are',
      c1: 'Cookies are small files your browser stores and sends to the website. In addition, the app keeps some data on the device itself (localStorage, sessionStorage and IndexedDB) so that work is not lost',
    },
    s2: {
      heading: '2. Cookies in use',
      c1: 'All our cookies are first-party. There are currently no analytics or advertising cookies; if any are added, they will run only after consent in the banner',
      table: {
        cookie: 'Cookie',
        purpose: 'Purpose',
        lifetime: 'Lifetime',
        category: 'Category',
      },
      purpose: {
        session: 'Keeps you signed in',
        callback: 'The page to return to after sign-in',
        csrf: 'Protection against cross-site request forgery (CSRF)',
        signOut: 'Prevents returning to the account after sign-out (this browser only)',
        loginHint: 'Remembers the address typed in the last sign-in attempt',
        resetHint: 'Remembers the address a password-reset link was sent to',
        locale: 'Interface language',
        consent: 'Stores your choice in the cookie banner',
        navRail: 'Side menu collapsed or open',
      },
      lifetime: {
        session: 'Until the browser closes, or 30 days with "remember me"',
        browser: 'Until the browser closes',
        days30: '30 days',
        min15: '15 minutes',
        year1: '1 year',
        days180: '180 days',
      },
      category: {
        essential: 'Essential',
        preference: 'Preference',
      },
    },
    storage: {
      heading: '3. Data kept on the device',
      c1: 'This data stays on the device and is not sent to us until you send it through an action in the system',
      table: {
        item: 'Name',
        where: 'Where',
        purpose: 'Purpose',
        lifetime: 'Lifetime',
      },
      purpose: {
        photoQueue: 'Photos taken during goods receiving without a network connection, until they upload',
        receiving: 'The goods-receipt draft and line marks, so they are not lost',
        nav: 'Menu preferences',
        attribution: 'How you reached the site (for example a campaign), sent with the contact form',
        temp: 'Temporary page state (for example a notice after a network switch)',
      },
      lifetime: {
        untilUploaded: 'Deleted as soon as the photo uploads',
        untilDone: 'Deleted when the receipt is finished',
        untilCleared: 'Until browser data is cleared',
        tab: 'Until the tab is closed',
      },
    },
    s3: {
      heading: '4. Managing consent',
      c1: 'In the consent banner you can accept or decline non-essential cookies, and change your choice at any time by deleting the consent cookie in your browser',
      c2: 'Blocking essential cookies or clearing browser data will sign you out, and may delete photos or drafts that have not uploaded yet',
    },
    s4: {
      heading: '5. More information',
      morePrefix: 'For details about the information we collect, see the',
      moreLink: 'Privacy Policy',
    },
  },
};
