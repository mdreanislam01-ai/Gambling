/**
 * Long-form policy documents, held in one bilingual module instead of the
 * database: these texts describe how the software actually behaves, so they are
 * reviewed together with the code that changes that behaviour.
 *
 * Nothing here is legal advice, and nothing here claims a monetary value for demo
 * credits. If a paragraph contradicts the code, the code wins — fix this file.
 *
 * Each section carries both languages and `legalDoc()` flattens one of them, so a
 * Bangla reader never receives an English paragraph and vice versa.
 */

const VERSION = '1.2.0';
const EFFECTIVE = '2026-01-01 00:00:00';

export const LEGAL_DOCS = ['terms', 'privacy', 'responsible', 'fairness', 'rules', 'security', 'help'];

const DOCS = {
  terms: {
    title: { en: 'Terms of use — demo platform', bn: 'ব্যবহারের শর্ত — ডেমো প্ল্যাটফর্ম' },
    sections: [
      {
        h: { en: '1. What this is', bn: '১. এটি কী' },
        p: {
          en: [
            'ArenaPlay is a demonstration build of a casino and sports-betting style product. It exists to show interface design, game mathematics and back-office workflow. It is not a gambling operator, it holds no licence, and it is not connected to any service that moves money.',
            'Everything you see is simulated: the wallet balance, the bet slips, the live studio rounds, the sports fixtures and the numbers in the admin panel. There is no deposit, no withdrawal, no purchase and no prize. Credits cannot be exchanged for money, goods or any other credit, and they have no resale value.',
          ],
          bn: [
            'ArenaPlay একটি ডেমো সংস্করণ — ক্যাসিনো ও স্পোর্টস বেটিং ধাঁচের পণ্যের ইন্টারফেস, গাণিতিক যান্ত্রিকতা এবং ব্যাক-অফিস কর্মপ্রবাহ দেখানোর জন্য তৈরি। এটি কোনো জুয়া পরিচালনাকারী প্রতিষ্ঠান নয়, এর কোনো লাইসেন্স নেই, এবং টাকা নড়াচড়া করায় এমন কোনো সেবার সাথে সংযুক্ত নয়।',
            'যা কিছু দেখছেন সব সিমুলেশন: ওয়ালেটের ব্যালেন্স, বেট স্লিপ, লাইভ স্টুডিওর রাউন্ড, স্পোর্টস ফিক্সচার আর অ্যাডমিন প্যানেলের সংখ্যা। এখানে ডিপোজিট নেই, উত্তোলন নেই, কেনাকাটা নেই, পুরস্কার নেই। ডেমো ক্রেডিট টাকা, পণ্য বা অন্য কোনো ক্রেডিটে বদলানো যায় না; এর কোনো পুনর্বিক্রয় মূল্য নেই।',
          ],
        },
      },
      {
        h: { en: '2. Eligibility', bn: '২. অংশগ্রহণের শর্ত' },
        p: {
          en: [
            'The demo is restricted to adults: you confirm you are 18 or over (or the age of majority where you live, if that is higher) when you register. Registration can be switched off by an administrator, and any account can be suspended.',
            'If the laws where you live prohibit even a simulated betting interface, do not use this build. Removing the demo layer and offering real money is outside the scope of this software, and it is refused by configuration: setting REAL_MONEY_ENABLED to true stops the server from starting.',
          ],
          bn: [
            'ডেমোটি কেবল প্রাপ্তবয়স্কদের জন্য: নিবন্ধনের সময় আপনি নিশ্চিত করেন যে আপনার বয়স ১৮ বা তার বেশি (আপনার এলাকায় প্রাপ্তবয়স্ক হওয়ার বয়স যদি তার চেয়ে বেশি হয়, তবে সেটি)। অ্যাডমিন চাইলে নিবন্ধন বন্ধ করতে পারেন, এবং যেকোনো অ্যাকাউন্ট স্থগিত করা যায়।',
            'আপনার এলাকার আইনে সিমুলেটেড বেটিং ইন্টারফেসও নিষিদ্ধ হলে এই বিল্ড ব্যবহার করবেন না। ডেমো স্তর সরিয়ে প্রকৃত অর্থ চালু করা এই সফটওয়্যারের আওতার বাইরে, এবং কনফিগারেশন দিয়েই তা প্রত্যাখ্যান হয় — REAL_MONEY_ENABLED = true রাখলে সার্ভার চালুই হবে না।',
          ],
        },
      },
      {
        h: { en: '3. Your account', bn: '৩. আপনার অ্যাকাউন্ট' },
        p: {
          en: [
            'One person may hold one account. Keep your password private; the platform stores only a salted scrypt hash and can never show it back to you, so a forgotten password is reset by email link rather than reminded.',
            'You may close your account at any time from Account → Settings. Closure signs every device out immediately, blocks new bets and logins, and keeps the record of past demo activity for the audit trail described in the privacy notice. An administrator can reactivate an account only while the data still contains it.',
          ],
          bn: [
            'একজনের একটিই অ্যাকাউন্ট থাকতে পারে। পাসওয়ার্ড গোপন রাখুন; প্ল্যাটফর্ম কেবল লবণ-মিশ্রিত scrypt হ্যাশ সংরক্ষণ করে, তাই তা কখনো আপনাকে দেখানো যায় না — ভুলে গেলে ইমেইল লিংক দিয়ে রিসেট করতে হয়, মনে করিয়ে দেওয়া যায় না।',
            'অ্যাকাউন্ট → সেটিংস থেকে যেকোনো সময় অ্যাকাউন্ট বন্ধ করা যায়। বন্ধ করলে সঙ্গে সঙ্গে সব ডিভাইস থেকে লগআউট হয়, নতুন বাজি ও লগইন আটকায়, এবং গোপনীয়তা নোটিশে বর্ণিত নিরীক্ষা-তালিকার জন্য পূর্ববর্তী ডেমো কার্যক্রমের বিবরণ থেকে যায়। তথ্য মৌজুদ থাকলে অ্যাডমিন তা পুনরায় সক্রিয় করতে পারেন।',
          ],
        },
      },
      {
        h: { en: '4. Credits, resets and no purchases', bn: '৪. ক্রেডিট, রিসেট এবং কেনাকাটা নেই' },
        p: {
          en: [
            'New accounts receive a demo balance. The daily bonus and the automatic reset exist to keep the demo playable; both can be turned off by an administrator, and neither creates an entitlement. A moderator can top up any account for testing.',
            'Because credits cannot be bought, sold or redeemed, nothing on this platform is a wager of value. The loss you see in the wallet is a number in a demo database.',
          ],
          bn: [
            'নতুন অ্যাকাউন্টে ডেমো ব্যালেন্স দেওয়া হয়। দৈনিক বোনাস ও স্বয়ংক্রিয় রিসেট ডেমো চালিয়ে যাওয়ার সুবিধার জন্য; অ্যাডমিন চাইলে দুটিই বন্ধ করতে পারেন, এবং কোনোটিই কোনো দাবি তৈরি করে না। পরীক্ষার জন্য একজন মডারেটর যেকোনো অ্যাকাউন্টে ক্রেডিট যোগ করতে পারেন।',
            'ক্রেডিট কেনা, বেচা বা মূল্যায়িত করা যায় না, তাই এই প্ল্যাটফর্মে আর্থিক মূল্যের কোনো বাজি নেই। ওয়ালেটে যে ক্ষতি দেখছেন তা একটি ডেমো ডেটাবেসের সংখ্যা মাত্র।',
          ],
        },
      },
      {
        h: { en: '5. Acceptable use', bn: '৫. গ্রহণযোগ্য ব্যবহার' },
        p: {
          en: [
            'Do not try to break the limits the server enforces: automated multi-accounting, bypassing rate limits, replaying somebody else’s session cookie, altering a bet after it is accepted, or scraping the API to feed a real-money product. Attempts are recorded and are grounds for suspension.',
            'Do not use this build in a way that presents simulated outcomes as real gambling results, and do not present the interface as an operator in any jurisdiction. The demo notices and the “simulated” labels are part of the product and must stay visible in derivative work.',
          ],
          bn: [
            'সার্ভার যে সীমা মানতে বাধ্য করে তা ভাঙার চেষ্টা করবেন না: স্বয়ংক্রিয়ভাবে একাধিক অ্যাকাউন্ট, রেট লিমিট এড়ানো, অন্যের সেশন কুকি পুনর্ব্যবহার, গৃহীত বাজি পরে বদলানো, বা প্রকৃত অর্থের পণ্যে ব্যবহারের জন্য API থেকে তথ্য সংগ্রহ। এসব প্রচেষ্টা লিপিবদ্ধ হয় এবং স্থগিত করার কারণ হয়।',
            'সিমুলেটেট ফলাফলকে প্রকৃত জুয়ার ফল হিসেবে উপস্থাপন করবেন না, এবং ইন্টারফেসটিকে কোনো এলাকার অপারেটর হিসেবে দেখাবেন না। ডেমো বিজ্ঞপ্তি ও “সিমুলেটেড” লেবেল পণ্যের অংশ; কোনো পরিবর্তিত সংস্করণেও সেগুলো দৃশ্যমান রাখতে হবে।',
          ],
        },
      },
      {
        h: { en: '6. Availability, changes and liability', bn: '৬. প্রাপ্যতা, পরিবর্তন এবং দায়' },
        p: {
          en: [
            'The demo may be reset, frozen for maintenance, or taken offline at any time; balances, history and preferences can be erased without notice. No uptime promise is made.',
            'The software is provided as-is, without warranty of any kind. To the extent the law allows, the authors are not liable for losses arising from use of this build — including any assumption that a simulated return, odds or streak would repeat anywhere else.',
          ],
          bn: [
            'ডেমো যেকোনো সময় রিসেট হতে পারে, রক্ষণাবেক্ষণের জন্য স্থগিত হতে পারে বা অফলাইন করা হতে পারে; ব্যালেন্স, ইতিহাস ও পছন্দ নোটিশ ছাড়াই মুছে ফেলা হতে পারে। কোনো আপটাইম প্রতিশ্রুতি দেওয়া হয় না।',
            'সফটওয়্যারটি যেকোনো প্রকার ওয়ারেন্টি ছাড়া, যেমন আছে তেমনভাবে দেওয়া হয়েছে। আইন যতটুকু অনুমতি দেয়, এই বিল্ড ব্যবহার থেকে উদ্ভূত ক্ষতির জন্য রচয়িতারা দায়ী থাকবেন না — কোনো সিমুলেটেট আয়, অডস বা ধারা অন্যত্র আবার ঘটবে বলে ধরে নেওয়াও তার মধ্যে পড়ে।',
          ],
        },
      },
      {
        h: { en: '7. These terms changing', bn: '৭. শর্তাবলি বদল' },
        p: {
          en: [
            'These terms can change. The version number in the header of this page is what an account accepted at registration; continued use after a change means the current version applies.',
            'Questions, corrections or a report about a suspected defect: open a ticket under Support, or write to the published support address.',
          ],
          bn: [
            'শর্তাবলি পরিবর্তন হতে পারে। নিবন্ধনের সময় কোন সংস্করণ গ্রহণ করা হয়েছিল তা এই পাতার হেডারে থাকা সংস্করণ নম্বর বলে দেয়; পরিবর্তনের পর ব্যবহার চালিয়ে গেলে বর্তমান সংস্করণ প্রযোজ্য।',
            'প্রশ্ন, সংশোধন বা সন্দেহভাজন ত্রুটির প্রতিবেদন: সহায়তা থেকে টিকিট খুলুন, অথবা প্রকাশিত সহায়তা ঠিকানায় লিখুন।',
          ],
        },
      },
    ],
  },

  privacy: {
    title: { en: 'Privacy notice', bn: 'গোপনীয়তা নোটিশ' },
    sections: [
      {
        h: { en: '1. What is stored', bn: '১. কী সংরক্ষণ করা হয়' },
        p: {
          en: [
            'Account record: email address, username, password hash, preferred language, avatar choice, the flag confirming you are an adult, account status, and the responsible-gaming limits you set.',
            'Wallet and play record: demo credit transactions, every bet with its stake, outcome, game configuration and the seed material used, and the daily aggregates used for limit checks.',
            'Operational record: session tokens (hashed), last-seen timestamps, your IP address stored only as a salted hash, and an audit log of privileged actions taken by staff accounts.',
          ],
          bn: [
            'অ্যাকাউন্টের রেকর্ড: ইমেইল, ইউজারনেম, পাসওয়ার্ড হ্যাশ, পছন্দের ভাষা, অ্যাভাটার নির্বাচন, প্রাপ্তবয়স্ক নিশ্চিতকরণ, অ্যাকাউন্টের অবস্থা এবং আপনি ঠিক করা দায়িত্বশীল-খেেলার সীমা।',
            'ওয়ালেট ও খেলার রেকর্ড: ডেমো ক্রেডিটের লেনদেন, প্রতিটি বাজির অংশ, ফলাফল, গেম কনফিগারেশন ও ব্যবহৃত সিড উপাদান, এবং সীমা যাচাইয়ে ব্যবহৃত দৈনিক সমষ্টি।',
            'পরিচালনাগত রেকর্ড: সেশন টোকেন (হ্যাশ করা), সর্বশেষ কার্যকর সময়, IP ঠিকানা কেবল লবণ-মিশ্রিত হ্যাশ হিসেবে, এবং স্টাফ অ্যাকাউন্টের বিশেষাধিকারপূর্ণ কাজের অডিট লগ।',
          ],
        },
      },
      {
        h: { en: '2. What is not stored', bn: '২. কী সংরক্ষণ করা হয় না' },
        p: {
          en: [
            'No payment card data, bank details, wallets or payment-provider identifiers — there is no payment integration in this build. No identity documents. No advertising trackers, no third-party analytics scripts and no social pixels: the pages load no code from another origin.',
            'Your password is never stored in a recoverable form, and neither support nor staff accounts can read it; they can only set a new one after you ask for a reset.',
          ],
          bn: [
            'কোনো পেমেন্ট কার্ডের তথ্য, ব্যাংক বিবরণ, ওয়ালেট বা পেমেন্ট-প্রোভাইডার শনাক্তকারী সংরক্ষিত হয় না — এই বিল্ডে কোনো পেমেন্ট সংযোগ নেই। কোনো পরিচয়পত্র নেই। কোনো বিজ্ঞাপনী ট্র্যাকার, তৃতীয় পক্ষের অ্যানালিটিক্স স্ক্রিপ্ট বা সোশ্যাল পিক্সেল নেই: পৃষ্ঠাগুলো অন্য উৎস থেকে কোনো কোড লোড করে না।',
            'আপনার পাসওয়ার্ড কখনো উদ্ধারযোগ্য আকারে রাখা হয় না; সহায়তা বা স্টাফও তা পড়তে পারেন না, রিসেটের অনুরোধে নতুন নির্ধারণ করতে পারেন মাত্র।',
          ],
        },
      },
      {
        h: { en: '3. Cookies and why', bn: '৩. কুকি এবং তার কারণ' },
        p: {
          en: [
            'Two cookies are used. A session cookie (HttpOnly, SameSite=Lax, Secure when served over HTTPS) keeps you signed in. A locale cookie remembers whether you read the site in Bangla or English, so a signed-out visitor keeps their language too. There are no advertising or tracking cookies.',
            'Account → Sessions signs every device out by deleting the stored session rows. Deleting the cookies alone ends this browser session but does not revoke the others.',
          ],
          bn: [
            'দুটি কুকি ব্যবহার হয়। সেশন কুকি (HttpOnly, SameSite=Lax, HTTPS হলে Secure) আপনাকে সাইন-ইন রাখে। লোকেল কুকি মনে রাখে আপনি সাইটটি বাংলায় না ইংরেজিতে পড়েন — সাইন-আউট দর্শকেরও ভাষার পছন্দ থেকে যায়। বিজ্ঞাপনী বা ট্র্যাকিং কুকি নেই।',
            'অ্যাকাউন্ট → সেশন থেকে সংরক্ষিত সেশন সারি মুছে সব ডিভাইস সাইন-আউট করা যায়। শুধু কুকি মুছলে এই ব্রাউজারের সেশন শেষ হয়, অন্যগুলো বাতিল হয় না।',
          ],
        },
      },
      {
        h: { en: '4. How long, and who sees it', bn: '৪. কতক্ষণ এবং কে দেখতে পায়' },
        p: {
          en: [
            'Demo data is retained until the environment is reset, which may happen at any time. A deployment that keeps data should set an explicit retention period and delete inactive accounts on a schedule; this build ships the export and deletion endpoints, not a scheduled purge.',
            'Staff accounts you can see in the admin panel read the records, and every privileged action they take is written to the audit log with the actor, the target, the reason and a timestamp. Logs never contain passwords, session tokens or raw IP addresses.',
          ],
          bn: [
            'ডেমো তথ্য পরিবেশ রিসেট না হওয়া পর্যন্ত থাকে, যা যেকোনো সময় হতে পারে। তথ্য রেখে এমন কোনো বণ্টনে স্পষ্ট অবধারিত সময় ঠিক করতে হবে এবং নিষ্ক্রিয় অ্যাকাউন্ট নির্ধারিত সময়ে মুছে ফেলতে হবে; এই বিল্ডে রপ্তানি ও মুছে ফেলার এন্ডপয়েন্ট আছে, স্বয়ংক্রিয় পরিষ্কারের টাস্ক নয়।',
            'অ্যাডমিন প্যানেলে দেখা যায় এমন স্টাফ অ্যাকাউন্টই রেকর্ড পড়তে পারে, এবং তাদের প্রতিটি বিশেষাধিকারপূর্ণ কাজ অডিট লগে জমা হয় — কার, কাদের বিরুদ্ধে, কী কারণে, কখন টাইমস্ট্যাম্পসহ। লগে কখনো পাসওয়ার্ড, সেশন টোকেন বা খোলা IP থাকে না।',
          ],
        },
      },
      {
        h: { en: '5. Your choices', bn: '৫. আপনার পছন্দ' },
        p: {
          en: [
            'Account → Data export produces the bets, credit transactions and profile rows that belong to you as JSON, which you can keep or hand to someone else. Account → Settings can close the account and revoke every session, and an administrator can erase profile fields on request.',
            'Responsible-gaming limits, self-exclusion and reality-check intervals are yours to set at any time. Self-exclusion cannot be lifted early by support — that is deliberate.',
          ],
          bn: [
            'অ্যাকাউন্ট → তথ্য রপ্তানি থেকে আপনার বাজি, ক্রেডিট লেনদেন ও প্রোফাইলের সারি JSON আকারে পাওয়া যায়, যা রাখা বা অন্যকে দেওয়া দুটোই যায়। অ্যাকাউন্ট → সেটিংস থেকে অ্যাকাউন্ট বন্ধ করা যায় ও সব সেশন বাতিল করা যায়; অনুরোধে অ্যাডমিন প্রোফাইলের ক্ষেত্রও মুছতে পারেন।',
            'দায়িত্বশীল-খেেলার সীমা, স্ব-নিষেধ ও রিয়েলিটি-চেকের ব্যবধান আপনি যেকোনো সময় ঠিক করতে পারেন। স্ব-নিষেধ সহায়তা টিমও আগেভাগে তুলে দিতে পারে না — এটি ইচ্ছাকৃত।',
          ],
        },
      },
      {
        h: { en: '6. Security practices', bn: '৬. নিরাপত্তা চর্চা' },
        p: {
          en: [
            'Password hashing uses scrypt with a per-user salt. Write requests require a same-origin CSRF token. Request bodies are size-capped, inputs are validated on the server before anything reaches SQL, and every statement is parameterised. Security headers, including a per-request Content-Security-Policy nonce, are set on every response.',
            'Repeated failed sign-ins lock the account for a period and notify the owner; the lock is applied server-side, so it holds even if cookies are cleared. Secrets live in environment variables and are never bundled into the frontend.',
          ],
          bn: [
            'পাসওয়ার্ড হ্যাশিং প্রতি ব্যবহারকারী আলাদা লবণসহ scrypt ব্যবহার করে। লেখার অনুরোধে একই উৎসের CSRF টোকেন লাগে। অনুরোধের আকার সীমিত, সার্ভারে যাচাই না হওয়া পর্যন্ত কিছু SQL-এ পৌঁছায় না, এবং প্রতিটি বিবৃতি প্যারামিটারাইজড। প্রতিটি উত্তরে নিরাপত্তা হেডার বসানো হয়, যার মধ্যে প্রতি অনুরোধে আলাদা Content-Security-Policy ননসও আছে।',
            'বারবার ব্যর্থ লগইনে অ্যাকাউন্ট এক সময়ের জন্য লক হয় ও মালিককে জানানো হয়; লক সার্ভার-পাশে, তাই কুকি মুছে ফেললেও থাকে। গোপন মান এনভায়রনমেন্ট ভ্যারিয়েবলে রাখা হয়, কখনো ফ্রন্টএন্ডে যুক্ত হয় না।',
          ],
        },
      },
    ],
  },

  responsible: {
    title: { en: 'Responsible gaming', bn: 'দায়িত্বশীল খেলা' },
    sections: [
      {
        h: { en: '1. No money, but the habits are real', bn: '১. টাকা নেই, অভ্যাস কিন্তু সত্যি' },
        p: {
          en: [
            'Nothing can be won or lost here in money. That does not make the behaviour harmless: repeating a fast bet with a rising pulse is the pattern that later becomes difficult, which is why the limits, reality checks, session counters and self-exclusion in this demo work exactly as they would in a live product.',
            'The controls below are enforced by the server, not by the page. Support staff cannot talk them out of the way, and clearing cookies does not bypass them.',
          ],
          bn: [
            'এখানে অর্থে কিছু জেতা বা হারা যায় না। তবু আচরণ নিষ্কোষ বলা যায় না: দ্রুত বাজি বারবার বসানো আর আবেগ বেড়ে যাওয়াই পরে সমস্যার রূপ নেয় — তাই এই ডেমোয় সীমা, রিয়েলিটি-চেক, সেশন কাউন্টার ও স্ব-নিষেধ ঠিক সেইভাবেই কাজ করে যেভাবে একটি প্রকৃত পণ্যে কাজ করত।',
            'নিচের নিয়ন্ত্রণগুলো পৃষ্ঠা নয়, সার্ভার প্রয়োগ করে। সহায়তা টিম কথা বলে এগুলো তুলে দিতে পারে না, কুকি মুছেও এড়ানো যায় না।',
          ],
        },
      },
      {
        h: { en: '2. Limits you can set', bn: '২. আপনি যে সীমা দিতে পারেন' },
        p: {
          en: [
            'Daily loss limit — once your net demo loss for the day reaches it, new bets are refused until the day rolls over.',
            'Weekly wager limit — a ceiling on how much you stake across seven days, independent of results.',
            'Session limit — how long one sitting may run before play stops.',
            'Reality check — a break reminder every N minutes that tells you how long you have been playing and what the session has done.',
            'A money product would also cap deposits; there is nothing to deposit here, so the equivalent control is the credit flows listed in your transaction history.',
          ],
          bn: [
            'দৈনিক ক্ষতির সীমা — দিনের নিট ডেমো ক্ষতি এই পরিমাণে পৌঁছালে দিন পাল্টানো পর্যন্ত নতুন বাজি প্রত্যাখ্যাত হয়।',
            'সাপ্তাহিক বাজির সীমা — সাত দিনে মোট কত অংশ লাগানো যাবে তার ছাদ, ফলাফল নির্বিশেষে।',
            'সেশন সীমা — একটি বসা কতক্ষণ চলার পর খেলা থামবে।',
            'রিয়েলিটি-চেক — প্রতি N মিনিটে বিরতির স্মরণ, যা বলে কতক্ষণ খেলছেন এবং এই সেশনে কী হয়েছে।',
            'অর্থের পণ্যে জমারও সীমা থাকত; এখানে জমার কিছু নেই, তাই সমতুল্য নিয়ন্ত্রণ হলো আপনার লেনদেন ইতিহাসে তালিকাভুক্ত ক্রেডিট প্রবাহ।',
          ],
        },
      },
      {
        h: { en: '3. Taking a break, and self-exclusion', bn: '৩. বিরতি এবং স্ব-নিষেধ' },
        p: {
          en: [
            'A cool-down blocks play for the hours you choose. Self-exclusion blocks it for the period you choose, signs every device out, and refuses new bets with a message naming the moment it ends — a six-month exclusion cannot be shortened on request.',
            'Support can extend an exclusion. It cannot cancel one. If you want that to change, the change has to happen after the period you chose has run.',
          ],
          bn: [
            'কুল-ডাউন আপনি বেছে নেওয়া ঘণ্টাখানেকের জন্য খেলা আটকায়। স্ব-নিষেধ আপনি ঠিক করা পুরো সময়ের জন্য আটকায়, সব ডিভাইস সাইন-আউট করে, এবং নতুন বাজি প্রত্যাখ্যান করে বলে দেয় কখন শেষ হবে — ছয় মাসের স্ব-নিষেধ অনুরোধে ছোট করা যায় না।',
            'সহায়তা টিম মেয়াদ বাড়াতে পারে, বাতিল করতে পারে না। এটি বদলাতে চাইলে আপনার ঠিক করা সময়টা শেষ হওয়া পর্যন্ত অপেক্ষা করতে হবে।',
          ],
        },
      },
      {
        h: { en: '4. Signs worth noticing', bn: '৪. যে লক্ষণগুলো গুরুত্বপূর্ণ' },
        p: {
          en: [
            'Chasing a loss, borrowing time you had promised someone else, thinking about the next session while doing something else, or hiding how much you played: these are the signs that a hobby has started to cost something, even when the currency is a demo number.',
            'If any of that sounds familiar, use the self-exclusion on this account and speak to someone — a friend, a family member, a doctor, or a licensed helpline in your country.',
          ],
          bn: [
            'হারাটা ফেরত পাওয়ার তাড়া, অন্যকে দেওয়া সময় ধার করা, অন্য কাজের মাঝেও পরের সেশনের কথা ভাওয়া, বা কত খেলছেন তা লুকিয়ে রাখা — এই লক্ষণগুলো বলে দেয় একটি শখ কিছু খাওয়াতে শুরু করেছে, মুদ্রা ডেমোর সংখ্যা হলেও।',
            'নিজের মধ্যে এগুলো চিনতে পারলে এই অ্যাকাউন্টে স্ব-নিষেধ ব্যবহার করুন, এবং কারো সাথে কথা বলুন — বন্ধু, পরিবারের সদস্য, চিকিৎসক, বা আপনার দেশের অনুমোদিত হেল্পলাইন।',
          ],
        },
      },
      {
        h: { en: '5. Getting help', bn: '৫. সাহায্য পাওয়া' },
        p: {
          en: [
            'This build does not advertise a specific gambling helpline, because the right number depends on where you are and helpline details change. Search for the national or regional problem-gambling service for your country, or ask a doctor or local health service for a referral; many offer chat, phone and in-person support at no cost.',
            'If you are here because of somebody else’s play, that is worth asking about too — family support lines are usually run by the same services.',
          ],
          bn: [
            'এই বিল্ড নির্দিষ্ট কোনো জুয়া-সহায়তা নম্বর প্রচার করে না, কারণ সঠিক নম্বর আপনার অবস্থানের উপর নির্ভর করে এবং হেল্পলাইনের তথ্য বদলায়। আপনার দেশের জাতীয় বা আঞ্চলিক সমস্যা-জুয়া সেবা খুঁজুন, বা চিকিৎসক কিংবা স্থানীয় স্বাস্থ্য সেবা থেকে রেফারেল নিন; অনেকগুলোই বিনামূল্যে চ্যাট, ফোন ও মুখোমুখি সহায়তা দেয়।',
            'আপনি যদি কারও খেলার কারণে এখানে এসে থাকেন, সে নিয়েও জানা দরকার — পরিবারের সহায়তা লাইন সাধারণত একই সংস্থা চালায়।',
          ],
        },
      },
    ],
  },

  fairness: {
    title: { en: 'How outcomes are decided', bn: 'ফলাফল যেভাবে নির্ধারিত হয়' },
    sections: [
      {
        h: { en: '1. Committed seed, then reveal', bn: '১. আগে সিড ঘোষণা, পরে প্রকাশ' },
        p: {
          en: [
            'Before you bet, the server already holds a secret server seed for the current period and shows you only its SHA-256 hash. Your bet also uses your own client seed and a nonce that increases with every bet. The outcome is HMAC-SHA256 over that material, reduced to the game’s own scale — so the number cannot change after you have seen the hash, and it cannot be picked to hurt or help you.',
            'When the seed rotates, the previous server seed is published. Every bet made under it can then be recomputed, by the verifier on the Fairness page or by your own script, and the game configuration that was in force is shown with it.',
          ],
          bn: [
            'আপনি বাজি বসানোর আগেই সার্ভারের বর্তমান সময়ের গোপন সার্ভার সিড তৈরি থাকে, আপনাকে দেখানো হয় শুধু তার SHA-256 হ্যাশ। আপনার বাজিতে নিজের ক্লায়েন্ট সিড এবং প্রতিটি বাজিতে বেড়ে যাওয়া ননসও ব্যবহার হয়। ফলাফল এই উপাদানের উপর HMAC-SHA256 দিয়ে বের করে গেমের নিজস্ব স্কেলে নামানো হয় — তাই হ্যাশ দেখার পর সংখ্যা বদলানো যায় না, এবং আপনাকে ক্ষতি বা লাভ দিতে বেছেও নেওয়া যায় না।',
            'সিড ঘোরানোর সময় পুরোনো সার্ভার সিড প্রকাশ করা হয়। তার আওতায় করা প্রতিটি বাজি তখন পুনর্গণনা করা যায় — ফেয়ারনেস পাতার যাচাইকার থেকে, বা আপনার নিজের স্ক্রিপ্ট থেকে — এবং তখনকার গেম কনফিগারেশনও সাথে দেখানো হয়।',
          ],
        },
      },
      {
        h: { en: '2. What verification can and cannot prove', bn: '২. যাচাই কী প্রমাণ করে, কী করে না' },
        p: {
          en: [
            'A verification answers one question: was this outcome derived from the committed seed, this nonce and this client seed, using the rules in force at the time? A match means the server did not swap the result. It does not mean the game is generous — the house edge is a property of the paytable, and it is disclosed on every game card.',
            'Round-driven games (the crash round, the live studio rounds) fix their result for the whole round before betting closes, and the round identifier on your bet points at that derivation, so your ticket stays verifiable even though you did not choose the moment.',
          ],
          bn: [
            'যাচাই একটি-ই উত্তর দেয়: ফলাফলটি কি ঘোষিত সিড, এই ননস ও এই ক্লায়েন্ট সিড থেকে, তখনকার নিয়ম মেনেই এসেছে? মিললে মানে সার্ভার ফল বদলায়নি। এর মানে এই নয় যে খেলা উদার — হাউজ এজ পে-আউট টেবিলের বৈশিষ্ট্য, এবং তা প্রতিটি গেম কার্ডে প্রকাশ করা আছে।',
            'রাউন্ড-চালিত খেলা (ক্র্যাশ রাউন্ড, লাইভ স্টুডিওর রাউন্ড) বাজি বন্ধ হওয়ার আগেই পুরো রাউন্ডের ফল স্থির করে, এবং আপনার টিকিটের রাউন্ড শনাক্তকারী সেই গণনার দিকেই ইঙ্গিত করে — তাই আপনি সময় না বাছলেও টিকিট যাচাইযোগ্য থাকে।',
          ],
        },
      },
      {
        h: { en: '3. Return, house edge and what RTP means', bn: '৩. আয়, হাউজ এজ এবং RTP-এর অর্থ' },
        p: {
          en: [
            'RTP is the share of wagered credits a game returns over a very large number of rounds — a property of the maths, not a promise about your evening. A 96% game is expected to return 96 credits for every 100 wagered across millions of rounds; a short session can sit far above or below it, and streaks are ordinary.',
            'The slot engines carry a relative paytable and a prize scale derived from the RTP the game card states, so changing a symbol weight or a payout in the admin panel moves the game’s return toward the number on the card instead of drifting away from it. npm run check:rtp measures every game and compares the measurement with the claim; a game whose maths and label disagree fails that check.',
            'Card games whose return depends on how the hand is played (blackjack, video poker) publish the paytable and the rules — dealer stands on all 17s, double after split allowed, one split per hand, no insurance, no surrender — because the advertised return is only reachable with the play those rules make possible.',
          ],
          bn: [
            'RTP হলো অসংখ্য রাউন্ডে বাজি রাখা ক্রেডিটের কত অংশ ফিরে আসে — এটি গণিতের বৈশিষ্ট্য, আপনার সন্ধ্যা কেমন কাটবে তার প্রতিশ্রুতি নয়। ৯৬% খেলা কোটি কোটি রাউন্ডে প্রতি ১০০ ক্রেডিটে ৯৬ ফিরে দেওয়ার কথা; ছোট সেশন অনেক উপরে বা নিচে থাকতে পারে, আর ধারা স্বাভাবিক।',
            'এখানে স্লট ইঞ্জিনে আপেক্ষিক পে-আউট টেবিল ও গেম কার্ডে ঘোষিত RTP থেকে নির্ণীত প্রাইজ স্কেল ব্যবহৃত হয়, তাই অ্যাডমিন প্যানেলে প্রতীকের ওজন বা পে-আউট বদলালে খেলার আয় কার্ডে লেখা সংখ্যার দিকেই যায়, এদিক-ওদিক নয়। npm run check:rtp প্রতিটি খেলার আয় মেপে দাবির সাথে তুলনা করে; গণিত ও লেবেলে অমিল হলে পরীক্ষাটি ব্যর্থ হয়।',
            'যেসব কার্ড খেলায় আয় নির্ভর করে হাত কেমন খেলা হয়েছে তার উপর (ব্ল্যাকজ্যাক, ভিডিও পোকার), সেখানে পে-আউট টেবিল ও নিয়ম প্রকাশ করা হয় — ডিলার সব ১৭-এ দাঁড়ায়, split-এর পর double চলে, প্রতি হাতে একটি split, insurance নেই, surrender নেই — কারণ ঘোষিত আয় সেই নিয়ম মেনে খেললেই সম্ভব।',
          ],
        },
      },
      {
        h: { en: '4. Sports and live studio play', bn: '৪. স্পোর্টস ও লাইভ স্টুডিও' },
        p: {
          en: [
            'Sports boards are clearly marked as demo data when no provider is configured: fixtures, odds and results come from the seeded data set, and a bet placed on them settles against the simulation, never against a real event. If a legitimate score provider is configured, each fixture records its source and last sync time, and no score is invented between updates.',
            'Live-style tables (roulette, baccarat, dream wheel) run on a scripted round clock with simulated dealers. The dealing, the round result and the seat display are generated by the same engines as the self-serve games, and the dealer, chat and camera-like presentation are labelled as simulated.',
          ],
          bn: [
            'কোনো প্রোভাইডার সংযুক্ত না থাকলে স্পোর্টস বোর্ডে স্পষ্টভাবে “ডেমো তথ্য” লেবেল থাকে: ফিক্সচার, অডস ও ফলাফল সিড করা ডেটাসেট থেকে আসে এবং বাজি সিমুলেশনের বিপরীতে মীমাংসা হয়, কখনো সত্যিকারের খেলার বিপরীতে নয়। বৈধ স্কোর প্রোভাইডার সংযুক্ত থাকলে প্রতিটি ফিক্সচারে তার উৎস ও সর্বশেষ সিঙ্ক সময় লেখা থাকে, দুই সিঙ্কের মাঝে কোনো স্কোর গড়ে তোলা হয় না।',
            'লাইভ-ধাঁচের টেবিল (রুলেট, ব্যাকারেট, ড্রিয়াম হুইল) স্ক্রিপ্ট দেওয়া রাউন্ড ঘড়িতে সিমুলেটেট ডিলার নিয়ে চলে। কার্ড বা চাকার ফল, রাউন্ড ও আসনের ছবি ঠিক একই ইঞ্জিনে তৈরি হয়, আর ডিলার, চ্যাট ও ক্যামেরার মতো উপস্থাপনা সিমুলেটেট বলেই চিহ্নিত থাকে।',
          ],
        },
      },
      {
        h: { en: '5. Randomness in this build', bn: '৫. এখানে দৈবচয়ন' },
        p: {
          en: [
            'Draws are derived from the committed seed with HMAC-SHA256 and consumed through a monotonic counter, so a round is reproducible rather than merely random. That choice is what makes verification possible; it is a deliberate trade, because the same property that lets you audit us means the stream is not a hardware entropy source.',
            'The demo therefore cannot be used as evidence that a production gambling RNG would be certified. A licensed deployment requires an independently tested RNG, formal game certification and a regulator-approved return disclosure.',
          ],
          bn: [
            'এখানে কার্ড বা সংখ্যা টানা হয় ঘোষিত সিড থেকে HMAC-SHA256 দিয়ে, একটি একমুখী গণকের ক্রমে, তাই রাউন্ডটি কেবল দৈব নয়, পুনরুৎপাদনযোগ্য। এইটাই যাচাই সম্ভব করেছে; এটি সচেতন বিনিময়, কারণ যে গুণটি আপনাকে আমাদের যাচাই করতে দেয় সেই জন্যেই এই স্রোত হার্ডওয়্যার এনট্রপি উৎস নয়।',
            'তাই এই ডেমো প্রমাণ হিসেবে ব্যবহার করা যাবে না যে অনুমোদিত কোনো জুয়া পণ্যের RNG সনদযোগ্য হবে। লাইসেন্সপ্রাপ্ত বণ্টনে স্বাধীনভাবে পরীক্ষিত RNG, আনুষ্ঠানিক গেম সনদ এবং নিয়ন্ত্রক-অনুমোদিত আয় প্রকাশ আবশ্যক।',
          ],
        },
      },
    ],
  },

  rules: {
    title: { en: 'How to play', bn: 'কীভাবে খেলবেন' },
    sections: [
      {
        h: { en: 'Stakes, credit and rounds', bn: 'অংশ, ক্রেডিট ও রাউন্ড' },
        p: {
          en: [
            'Every bet is placed in demo credits. Each game card shows its minimum and maximum stake, and the number you type is checked by the server against the game record, so a stake the game does not accept is refused with an explanation rather than silently rounded. A round that cannot be completed returns your stake as a refund transaction, and you can see it in the wallet history.',
            'Your balance, the stake box and the potential return update together, so what a bet would pay is visible before you confirm it. After a round you can open the result and verify it.',
          ],
          bn: [
            'প্রতিটি বাজি ডেমো ক্রেডিটে বসে। প্রতিটি গেম কার্ডে সর্বনিম্ন ও সর্বোচ্চ অংশ লেখা থাকে; আপনি যা লিখছেন তা সার্ভার গেম রেকর্ডের সাথে মেলায়, তাই গেম যে অংশ নেয় না তা ব্যাখ্যাসহ প্রত্যাখ্যাত হয়, চুপচাপ গোল করা হয় না। যে রাউন্ড শেষ করা যায় না, তার অংশ “রিফান্ড” লেনদেন হিসেবে ফিরে আসে এবং ওয়ালেট ইতিহাসে দেখা যায়।',
            'আপনার ব্যালেন্স, অংশের বাক্স ও সম্ভাব্য ফেরত একসাথে বদলায়, তাই নিশ্চিত করার আগেই দেখা যায় বাজিটি জিতলে কত পাওয়া যাবে। রাউন্ডের পর ফল খুলে যাচাই করা যায়।',
          ],
        },
      },
      {
        h: { en: 'Slots', bn: 'স্লট' },
        p: {
          en: [
            'Three or five reels, three rows, and a set of paylines read from left to right. A winning line is a run of the same symbol starting at the leftmost reel; wild substitutes for any symbol except scatter. The paytable beside the reels lists what each symbol pays per line at the scale this game uses.',
            'Scatters count anywhere on the grid and start a free-spin round at the bonus multiplier where the game offers one. Games marked as having no bonus contain no scatter symbol and cannot award free spins.',
          ],
          bn: [
            'তিন বা পাঁচটি রিল, তিন সারি, এবং বাঁ দিক থেকে ডানে পড়া পে-লাইনের সেট। জেতা লাইন মানে সবচেয়ে বাঁয়ের রিল থেকে শুরু হওয়া একই প্রতীকের ধারা; wild scatter বাদে যেকোনো প্রতীকের জায়গায় বসতে পারে। রিলের পাশের পে-আউট টেবিলে প্রতিটি প্রতীক প্রতি লাইনে কত দেয়, এই খেলার স্কেলে দেখানো আছে।',
            'যে খেলায় বোনাস আছে সেখানে scatter যেকোনো ঘরে গুনা হয় এবং বোনাস গুণকসহ ফ্রি-স্পিন রাউন্ড শুরু করে। “বোনাস নেই” চিহ্নিত খেলায় scatter-ই থাকে না, ফ্রি-স্পিনও পড়বে না।',
          ],
        },
      },
      {
        h: { en: 'Roulette', bn: 'রুলেট' },
        p: {
          en: [
            'A single-zero European wheel: thirty-seven pockets, and zero loses against every even-money bet. Straight pays 35:1, split 11:1, street 11:1, corner 8:1, line 5:1, dozen and column 2:1, and the outside bets 1:1. The server holds the payout for each type, and the slip refuses a group the layout cannot build — a split across the end of a row, for example.',
            'A multi-leg slip adds every leg into one accepted bet; each leg is scored separately and the payouts are summed.',
          ],
          bn: [
            'এক শূন্যের ইউরোপীয় চাকা: সাতত্রিশটি ঘর, এবং জোড়-বাগান সব বাজিতে শূন্য হারে। সরাসরি ৩৫:১, split ১১:১, street ১১:১, corner ৮:১, line ৫:১, dozen ও column ২:১, আর বাইরের বাজি ১:১। প্রতিটি ধরনের পের সার্ভারেই লেখা, আর লেআউট যে গ্রুপ বানাতে পারে না (যেমন সারির শেষে split) তা স্লিপ প্রত্যাখ্যান করে।',
            'একাধিক পায়ের স্লিপের সব অংশ মিলে একটি গৃহীত বাজি হয়; প্রতিটি পা আলাদাভাবে বিচারিত হয় এবং পে-আউটগুলো যোগ হয়।',
          ],
        },
      },
      {
        h: { en: 'Blackjack', bn: 'ব্ল্যাকজ্যাক' },
        p: {
          en: [
            'Six decks, dealer stands on all 17s, blackjack pays 3:2, double after split allowed, one split per hand, no surrender. A player blackjack beats a dealer 21. Insurance is not offered at this table: when the dealer shows an Ace there is no side bet to take, and the dealer’s blackjack ends the round under the same rule as everywhere else.',
            'Hit, stand, double and split appear only when they are legal for the hand you hold — an action that cannot be taken is not shown as a button.',
          ],
          bn: [
            'ছয়টি ডেক, ডিলার সব ১৭-এ দাঁড়ায়, blackjack ৩:২ দেয়, split-এর পর double চলে, প্রতি হাতে একটি split, surrender নেই। খেলোয়াড়ের blackjack ডিলারের ২১-কে হারায় না। এই টেবিলে insurance নেই: ডিলারের প্রথম কার্ড Ace হলেও নেওয়ার মতো কোনো সাইড বাজি নেই, আর ডিলারের blackjack অন্য সর্বত্র যেমন নিয়মে রাউন্ড শেষ করে তেমনই শেষ করে।',
            'hit, stand, double ও split কেবল তখনই দেখানো হয় যখন আপনার হাতে সেটি বৈধ — যে কাজ চলবে না, তার বোতাম দেখানো হয় না।',
          ],
        },
      },
      {
        h: { en: 'Baccarat', bn: 'ব্যাকারেট' },
        p: {
          en: [
            'Punto Banco drawing rules, with no decisions for the player: Player pays 1:1, Banker pays 0.95:1 after the 5% commission, and Tie pays 8:1 while pushing the Player and Banker bets. The pair sides pay 10:1 when the first two cards of that hand match.',
            'Totals are modulo 10, tens and picture cards count as zero, and a natural 8 or 9 stands.',
          ],
          bn: [
            'Punto Banco টানা-নিয়ম, খেলোয়াড়ের কোনো সিদ্ধান্ত নেই: Player ১:১, Banker ৫% কমিশনের পর ০.৯৫:১, আর Tie ৮:১ দেয়, সাথে Player/Banker বাজি ফেরত যায়। সেই হাতের প্রথম দুই কার্ড মিললে pair সাইড ১০:১ দেয়।',
            'মোট ১০-এর ভিত্তিতে গনা হয়, ১০ ও চিত্রের কার্ড শূন্য, আর natural ৮ বা ৯-এ আর কার্ড আসে না।',
          ],
        },
      },
      {
        h: { en: 'Video poker', bn: 'ভিডিও পোকার' },
        p: {
          en: [
            'Jacks or Better on a 9/6 paytable: five cards are dealt, you choose which to hold, and the rest are replaced once. A pair of Jacks or better is the weakest paying hand; a royal flush pays 250 for one, four of a kind 25 and a full house 9.',
            'The published return is for that paytable played well. Holding the wrong cards is the difference between roughly 99% and something much worse — the hand names on the screen use the same ranking the engine scores.',
          ],
          bn: [
            '9/6 পে-আউট টেবিলে Jacks or Better: পাঁচটি কার্ড আসে, আপনি কোনগুলো রাখবেন তা বাছেন, বাকিগুলো একবার বদলায়। সবচেয়ে ছোট জেতা হাত Jack বা তার বড় এক জোড়া; royal flush একটিতে ২৫০, four of a kind ২৫, full house ৯ দেয়।',
            'প্রকাশিত আয় সেই পে-আউট টেবিল সঠিকভাবে খেলার জন্য। ভুল কার ধরে রাখা প্রায় ৯৯% আর অনেক খারাপের মাঝের তফাত — পর্দায় হাতের নামগুলো ঠিক সেই ক্রম যেটি ইঞ্জিন বিচার করে।',
          ],
        },
      },
      {
        h: { en: '3-patti', bn: 'থ্রি প্যাতি' },
        p: {
          en: [
            'Three cards against the dealer. Ranking, strongest first: trail, pure sequence, sequence, colour, pair, high card. Player pays 1:1, and the dealer wins a tie — that is where the house edge on the main bet comes from.',
            'Pair Plus pays on your own hand alone: pair 1:1, colour 3:1, sequence 7:1, pure sequence 17:1, trail 27:1. There is no Tie side bet at this table, because a bet that needs both hands to match rank for rank pays out so rarely that any honest price for it looks like a trap.',
          ],
          bn: [
            'ডিলারের বিরুদ্ধে তিনটি কার্ড। ক্রম, সর্বোচ্চ থেকে: trail, pure sequence, sequence, colour, pair, high card। Player ১:১ দেয়, আর টাই পড়লে ডিলার জিতে — মূল বাজির হাউজ এজ এখান থেকেই আসে।',
            'Pair Plus শুধু আপনার নিজের হাত দেখে: pair ১:১, colour ৩:১, sequence ৭:১, pure sequence ১৭:১, trail ২৭:১। এই টেবিলে Tie সাইড বাজি নেই, কারণ দুই হাতই অক্ষরে অক্ষরে মিলবে এমন বাজি এত বিরল যে তার সৎ দাম দিলেও সেটি ফাঁদের মতো দেখায়।',
          ],
        },
      },
      {
        h: { en: 'Dice, mines, wheel, plinko, bingo', bn: 'ডাইস, মাইনস, হুইল, প্লিংকো, বিংগো' },
        p: {
          en: [
            'Dice: choose a target and whether you want under or over. The multiplier is the inverse of the chance minus the house edge, and the game shows you both numbers before you bet.',
            'Mines: pick squares on a 25-cell grid. Each safe pick raises the multiplier by the exact inverse of surviving so far, and you bank it whenever you like. A mine ends the round and takes the stake.',
            'Wheel: call a multiplier from the wheel’s ladder. The wheel either stops in a winning segment for that multiplier or takes the stake, and the number of winning segments is shown before you spin.',
            'Plinko: the ball drops through twelve rows, one fair bounce each, and the bucket it lands in pays the table printed on the board. Three risk levels have different shapes and the same target return.',
            'Bingo: a 3×3 card with the centre square free, against a short call list. One line, two lines or the whole card pay different amounts, and missing every line is the normal case.',
          ],
          bn: [
            'ডাইস: একটি লক্ষ্য বাছুন এবং under নাকি over চান তা ঠিক করুন। গুণকটি সম্ভাবনার বিপরীত থেকে হাউজ এজ বাদ দিয়ে নির্ধারিত, এবং বাজির আগে দুটি সংখ্যাই খেলা দেখায়।',
            'মাইনস: ২৫টি ঘরের গ্রিডে ঘর বাছুন। প্রতিটি নিরাপদ বাছাই এ পর্যন্ত টিকে থাকার সঠিক বিপরীত সম্ভাবনামতো গুণক বাড়ায়, আর আপনি খুশি হলে তা তুলে নিন। মাইন লাগলে রাউন্ড শেষ ও অংশ হারা।',
            'হুইল: চাকার সিঁড়ি থেকে একটি গুণক ডাকুন। চাকা সেই অনুযায়ী জেতা সেগমেন্টে থামলে গুণক পান, নইলে অংশ যায়; ঘোরানোর আগে কয়টি সেগমেন্ট জেতে তা দেখানো হয়।',
            'প্লিংকো: বল বারোটি সারি ভেদ করে নিচে নামে, প্রতি সারিতে একটি করে নিরপেক্ষ বাউন্স, এবং যে বাকেটে থামে বোর্ডে ছাপা সেই পে-আউট পায়। তিনটি ঝুঁকি স্তরের আকৃতি আলাদা, লক্ষ্য আয় এক।',
            'বিংগো: মাঝের ঘরটি ফ্রি, ৩×৩ কার্ড, একটি ছোট কল-তালিকার বিপরীতে। একটি লাইন, দুটি লাইন বা পুরো কার্ড — আলাদা আলাদা পে-আউট, আর কোনো লাইন না হওয়াটাই স্বাভাবিক।',
          ],
        },
      },
      {
        h: { en: 'Crash and live studio', bn: 'ক্র্যাশ ও লাইভ স্টুডিও' },
        p: {
          en: [
            'Crash runs on the server clock: a betting window, then a multiplier that climbs until the round busts. Cash out before the bust to take your stake times the multiplier you stopped at; the bust point was fixed before betting closed. An auto-cashout is a standing instruction you can set with the bet.',
            'Live studio tables take bets only while their round is open, and the countdown to the next round is on screen. The dealer and the table presentation are simulated; the round maths is the same engine as the self-serve version.',
          ],
          bn: [
            'ক্র্যাশ সার্ভারের ঘড়িতে চলে: আগে বাজির জানালা, তারপর একটি গুণক রাউন্ড ব্াস্ট না হওয়া পর্যন্ত ওঠে। ব্াস্টের আগে ক্যাশ-আউট করলে থামা মুহূর্তের গুণক দিয়ে অংশ ফিরে পান; ব্াস্ট-বিন্দু বাজি বন্ধ হওয়ার আগেই স্থির হয়ে থাকে। বাজির সাথে auto-cashout বসিয়ে রাখা যায়।',
            'লাইভ স্টুডিওর টেবিলে বাজি কেবল রাউন্ড খোলা থাকলে চলে, পরের রাউন্ডের কাউন্টডাউন পর্দায় দেখা যায়। ডিলার ও টেবিলের উপস্থাপনা সিমুলেটেট; তবে রাউন্ডের গণিত সেল্ফ-সার্ভ সংস্করণের একই ইঞ্জিন।',
          ],
        },
      },
    ],
  },

  security: {
    title: { en: 'Security and account safety', bn: 'নিরাপত্তা ও অ্যাকাউন্ট সুরক্ষা' },
    sections: [
      {
        h: { en: '1. What the server enforces', bn: '১. সার্ভার যা বাধ্যতামূলক করে' },
        p: {
          en: [
            'Authentication is a session token in an HttpOnly, SameSite=Lax cookie, hashed at rest and revocable per device. Passwords are salted scrypt hashes with a minimum length and complexity that the same ruleset checks in the browser and on the server. Every state-changing request must carry a CSRF token the server issued for your session.',
            'Inputs are validated and typed before they reach SQL, and all statements are parameterised. Request bodies are size-limited, malformed JSON is rejected with an error code, and an unauthenticated call to a private route gets a 401 rather than a partial answer.',
          ],
          bn: [
            'প্রমাণীকরণ HttpOnly, SameSite=Lax কুকিতে থাকা সেশন টোকেন, যা সংরক্ষণে হ্যাশ করা এবং প্রতি ডিভাইসে আলাদাভাবে বাতিলযোগ্য। পাসওয়ার্ড লবণ-মিশ্রিত scrypt হ্যাশ, এবং সর্বনিম্ন দৈর্ঘ্য ও জটিলতার নিয়ম ব্রাউজার ও সার্ভার দুজায়গাতেই এক। অবস্থা বদলানো প্রতিটি অনুরোধে আপনার সেশনের জন্য সার্ভার দেওয়া CSRF টোকেন লাগে।',
            'SQL-এ পৌঁছানোর আগে ইনপুট যাচাই ও টাইপ করা হয়, এবং সব বিবৃতি প্যারামিটারাইজড। অনুরোধের আকার সীমিত, বেঠিক JSON ত্রুটি কোডে প্রত্যাখ্যাত, আর গোপন রুটে অপ্রমাণীকৃত কল আংশিক উত্তর নয়, ৪০১ পায়।',
          ],
        },
      },
      {
        h: { en: '2. Brute force and abuse', bn: '২. ব্রুট-ফোর্স ও দুর্ব্যবহার' },
        p: {
          en: [
            'Failed sign-ins are counted per account and lock it for a period with a notification to the owner; the lock is checked before the password comparison, so a locked account is not offered a guessing game. Login, registration, betting and admin write routes each have their own rate-limiter window.',
            'Unknown-account and wrong-password answers are indistinguishable on purpose. Password reset tokens expire, are single use, and an attempt to use a stale token tells you nothing about whether the address exists.',
          ],
          bn: [
            'ব্যর্থ লগইন অ্যাকাউন্টপ্রতি গনা হয় এবং মালিককে জানানো দিয়ে এক সময়ের জন্য অ্যাকাউন্ট লক করে; পাসওয়ার্ড মেলানোর আগেই এই যাচাই চলে, তাই লক করা অ্যাকাউন্টে অনুমানের খেলা খোলা থাকে না। লগইন, নিবন্ধন, বাজি ও অ্যাডমিন লেখার রুটে আলাদা আলাদা রেট-লিমিটার জানালা আছে।',
            'না-থাকা অ্যাকাউন্ট আর ভুল পাসওয়ার্ডের উত্তর ইচ্ছাকৃতভাবে অভিন্ন। পাসওয়ার্ড রিসেট টোকেনের মেয়াদ থাকে, একবারই চলে, এবং পুরোনো টোকেন ব্যবহারের চেষ্টা থেকে ঠিকানাটি আছে কি না তা জানা যায় না।',
          ],
        },
      },
      {
        h: { en: '3. Staff access', bn: '৩. স্টাফ প্রবেশাধিকার' },
        p: {
          en: [
            'Admin routes are protected on the server by role, not by hiding buttons: a moderator reads users and reports; only an admin edits users, credits, games, banners, announcements and settings. An admin cannot demote or lock the last admin seat, and privileged changes require a written reason.',
            'Every privileged action is appended to an audit log with the actor, the target, the reason and the salted hash of the request IP. The log is read-only for staff, and exporting it is itself audited.',
          ],
          bn: [
            'অ্যাডমিন রুট ভূমিকা দিয়ে সার্ভারেই সুরক্ষিত, বোতাম লুকিয়ে নয়: মডারেটর ব্যবহারকারী ও প্রতিবেদন পড়তে পারেন; ব্যবহারকারী, ক্রেডিট, গেম, ব্যানার, ঘোষণা ও সেটিংস শুধু অ্যাডমিন বদলাতে পারেন। একজন অ্যাডমিন শেষ অ্যাডমিন আসনটি নিজের থেকে নামাতে বা লক করতে পারেন না, এবং বিশেষাধিকারপূর্ণ পরিবর্তনে লিখিত কারণ দরকার।',
            'প্রতিটি বিশেষাধিকারপূর্ণ কাজ অডিট লগে যুক্ত হয় — কার, কাদের বিরুদ্ধে, কী কারণে, এবং অনুরোধের IP-এর লবণ-মিশ্রিত হ্যাশসহ। স্টাফের কাছে লগটি শুধু-পড়ার, আর তার রপ্তানিও অডিটে ওঠে।',
          ],
        },
      },
      {
        h: { en: '4. What a demo cannot promise', bn: '৪. ডেমো যা প্রতিশ্রুতি দিতে পারে না' },
        p: {
          en: [
            'This build ships no payment integration, no card data and no identity documents, so the attack surface a money product must defend is not exercised here. A deployment that ever moves value needs its own review: PCI scope, KYC and AML controls, a certified RNG, penetration testing, regulator reporting and a responsible-gaming programme with human support.',
            'Values in this repository are configuration, not credentials: sessions are signed with a per-installation key, and the seed accounts printed in the README exist only to make a fresh local database testable.',
          ],
          bn: [
            'এই বিল্ডে কোনো পেমেন্ট সংযোগ, কার্ডের তথ্য বা পরিচয়পত্র নেই, তাই অর্থ চালিত পণ্যকে যে আক্রমণপথ রক্ষা করতে হয় তা এখানে চলে না। যে বণ্টন কখনো মূল্য নেবে, তার নিজস্ব পর্যালোচনা লাগবে: PCI পরিধি, KYC ও AML নিয়ন্ত্রণ, সনদপ্রাপ্ত RNG, অনুপ্রবেশ-পরীক্ষা, নিয়ন্ত্রক প্রতিবেদন এবং মানুষসহ দায়িত্বশীল-খেেলার কার্যক্রম।',
            'এই রিপোজিটরির মানগুলো কনফিগারেশন, প্রমাণপত্র নয়: সেশন প্রতি স্থাপনের নিজস্ব চাবিতে স্বাক্ষরিত, আর README-তে ছাপা সিড অ্যাকাউন্টগুলো শুধু নতুন লোকাল ডেটাবেস পরীক্ষার জন্য।',
          ],
        },
      },
    ],
  },

  help: {
    title: { en: 'Getting help', bn: 'সহায়তা' },
    sections: [
      {
        h: { en: '1. First things to check', bn: '১. প্রথমে যা দেখবেন' },
        p: {
          en: [
            'A refused bet usually names its reason: the stake is outside the game’s limits, the balance is short, a responsible-gaming limit has been reached, the round closed while you were deciding, or that bet type is not offered on the table. The message carries the number that caused the refusal.',
            'If a game looks stuck, the round probably closed while the tab slept. The bet list and the wallet are authoritative: a hand you did not finish is voided and refunded within a minute, so you see a refund rather than a silent loss.',
          ],
          bn: [
            'বাজি প্রত্যাখ্যাত হলে কারণটা লেখা থাকে: অংশ খেলার সীমার বাইরে, ব্যালেন্স কম, দায়িত্বশীল-খেেলার সীমায় পৌঁছে গেছেন, সিদ্ধান্ত নেওয়ার সময় রাউন্ড বন্ধ হয়েছে, বা সেই টেবিলে বাজির ধরন নেই। কোন সংখ্যাটায় অসুবিধা, তা বার্তায় থাকে।',
            'খেলা আটকে থাকলে মনে করবেন ট্যাব ঘুমিয়ে থাকার সময় রাউন্ড বন্ধ হয়েছে। বাজির তালিকা ও ওয়ালেটই প্রমাণিক: যে হাত শেষ করেননি তা এক মিনিটের মধ্যে বাতিল হয়ে অংশ ফেরত যায়, তাই চুপচাপ হারার বদলে আপনি রিফান্ড দেখবেন।',
          ],
        },
      },
      {
        h: { en: '2. Verifying a result', bn: '২. ফলাফল যাচাই' },
        p: {
          en: [
            'Open the bet, then Verify. A bet made under a server seed that is still secret cannot be verified yet — the page says so and shows the hash that was published at the time. Once the seed rotates, the same check recomputes the outcome and reports whether it matches.',
            'Verification needs the game configuration as well as the seeds, because a paytable change is a rules change; both are shown in the result.',
          ],
          bn: [
            'বাজি খুলে Verify চাপুন। যে বাজি এখনো গোপন থাকা সার্ভার সিডের অধীনে, তা এখনই যাচাই করা যাবে না — পৃষ্ঠা সেটাই বলে এবং তখন প্রকাশিত হ্যাশ দেখায়। সিড ঘোরানোর পর একই পরীক্ষা ফল পুনর্গণনা করে মিলছে কি না জানায়।',
            'যাচাইতে সিডের সাথে গেম কনফিগারেশনও লাগে, কারণ পে-আউট টেবিল বদল মানে নিয়ম বদল; ফলাফলে দুটোই দেখানো হয়।',
          ],
        },
      },
      {
        h: { en: '3. Contacting support', bn: '৩. সহায়তার সাথে যোগাযোগ' },
        p: {
          en: [
            'Support lives in the app: Account → Support opens a ticket, and the thread stays on your account rather than in an inbox you have to remember. Include the bet identifier of anything you are asking about — it points at the exact round and its seed material.',
            'Password trouble: request a reset from the sign-in page. This demo has no mail transport, so the reset link is held in the development mailbox the sign-in page links to while the server runs locally; no email ever leaves the machine.',
          ],
          bn: [
            'সহায়তা অ্যাপের ভেতরেই: অ্যাকাউন্ট → Support থেকে টিকিট খোলে, এবং আলোচনা আপনার ইনবক্সে নয়, অ্যাকাউন্টেই থেকে যায়। যে বাজি নিয়ে জানতে চান তার শনাক্তকারী লিখুন — তা ঠিক সেই রাউন্ড ও তার সিড উপাদানের দিকে ইঙ্গিত করে।',
            'পাসওয়ার্ডে সমস্যা: সাইন-ইন পৃষ্ঠা থেকে রিসেট চান। এই ডেমোতে কোনো মেইল পরিবহন নেই, তাই রিসেট লিংকটি উন্নয়ন-মেইলবক্সে রাখা হয়, যেখানে লোকাল সার্ভার চলাকালে সাইন-ইন পৃষ্ঠাই লিঙ্ক দেয়; কোনো ইমেইল যন্ত্রটি ছেড়ে বের হয় না।',
          ],
        },
      },
      {
        h: { en: '4. If play stops being fun', bn: '৪. খেলা আর বিনোদন না হলে' },
        p: {
          en: [
            'Responsible-gaming tools are on the account page: daily loss, weekly wager, session length, reality checks, a cool-down and self-exclusion. A limit takes effect immediately, and self-exclusion signs every device out.',
            'The same page links the policy that explains each control. If you want help outside this product, a national or regional problem-gambling service in your country is the right place to start.',
          ],
          bn: [
            'দায়িত্বশীল-খেেলার ফিচার অ্যাকাউন্ট পাতায়: দৈনিক ক্ষতি, সাপ্তাহিক বাজি, সেশনের দৈর্ঘ্য, রিয়েলিটি-চেক, কুল-ডাউন ও স্ব-নিষেধ। সীমা সঙ্গে সঙ্গে কার্যকর হয়, আর স্ব-নিষেধ সব ডিভাইস থেকে সাইন-আউট করে দেয়।',
            'প্রতিটি নিয়ন্ত্রণ কী বোঝায় তা সেই একই পাতার নীতিমালার লিঙ্কে আছে। এই পণ্যের বাইরে সাহায্য চাইলে আপনার দেশের জাতীয় বা আঞ্চলিক সমস্যা-জুয়া সেবা থেকে শুরু করুন।',
          ],
        },
      },
    ],
  },
};

/** Pick one language out of a bilingual document. */
export function legalDoc(key, lang = 'en') {
  const doc = DOCS[key];
  if (!doc) return null;
  const language = lang === 'bn' ? 'bn' : 'en';
  return {
    key,
    locale: language,
    title: doc.title[language] ?? doc.title.en,
    version: doc.version ?? VERSION,
    effective: doc.effective ?? EFFECTIVE,
    sections: doc.sections.map((section) => ({
      heading: section.h?.[language] ?? section.h?.en ?? '',
      paragraphs: (section.p?.[language] ?? section.p?.en ?? []).filter(Boolean),
    })),
  };
}

/** Every published document, for an index. */
export function legalIndex(lang = 'en') {
  return LEGAL_DOCS.map((key) => {
    const doc = legalDoc(key, lang);
    return { key: doc.key, title: doc.title, version: doc.version, effective: doc.effective, sections: doc.sections.length };
  });
}

/**
 * Both languages must carry the same number of sections and paragraphs, so a
 * translation cannot quietly drop a clause. The test suite calls this.
 */
export function legalParity() {
  const problems = [];
  for (const key of LEGAL_DOCS) {
    const en = legalDoc(key, 'en');
    const bn = legalDoc(key, 'bn');
    if (!en || !bn) {
      problems.push(`${key}: missing document`);
      continue;
    }
    if (en.sections.length !== bn.sections.length) {
      problems.push(`${key}: ${en.sections.length} EN sections vs ${bn.sections.length} BN`);
    }
    en.sections.forEach((section, i) => {
      const other = bn.sections[i];
      if (!other) return;
      if (section.paragraphs.length !== other.paragraphs.length) {
        problems.push(`${key} section ${i + 1}: ${section.paragraphs.length} EN paragraphs vs ${other.paragraphs.length} BN`);
      }
      if (!other.heading) problems.push(`${key} section ${i + 1}: empty Bangla heading`);
    });
  }
  return problems;
}

export default DOCS;
