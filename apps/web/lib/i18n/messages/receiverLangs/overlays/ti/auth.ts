import type { Shape } from '../../../../translate';
import type { he } from '../../../auth/he';

/** auth — ti overlay (Tigrinya). */
export const auth: Shape<Pick<typeof he, 'login' | 'checkEmail' | 'twoFactor'>> = {
  login: {
    title: 'ናብ RestoMatch እተዉ',
    subtitle: 'ብመሕለፊ ቃልኩም እተዉ፡ ወይ ብኢመይል ናይ ምእታው ሊንክ ተቐበሉ።',
    email: 'ኣድራሻ ኢመይል',
    emailPlaceholder: 'you@restaurant.com',
    password: 'መሕለፊ ቃል',
    rememberMe: 'ኣብዚ መሳርሒ ዘክሩኒ',
    submit: 'እተዉ',
    or: 'ወይ',
    magicLabel: 'ኣድራሻ ኢመይል ንሊንክ ምእታው',
    magicSubmit: 'ናይ ምእታው ሊንክ ብኢመይል ስደዱለይ',
    forgot: 'መሕለፊ ቃልኩም ረሲዕኩም?',
    invitedHint: 'ዕድምኹም ናብዚ ኣድራሻ እዩ ተላኢኹ — ተበጻሕነት ንምርካብ ብእኡ እተዉ።',
    sent: 'ናብ ኢመይልኩም ናይ ምእታው ሊንክ ሰዲድና። ኢመይልኩም ርኣዩ።',
    resetDone: 'መሕለፊ ቃልኩም ተቐይሩ፡ ካብ ኩሎም መሳርሒታት ድማ ወጺእኩም። ብሓድሽ መሕለፊ ቃልኩም እተዉ።',
    signedOut: 'ወጺእኩም ኣለኹም።',
    errors: {
      verification: 'እዚ ሊንክ ግዜኡ ሓሊፉ ወይ ድሮ ተጠቒምኩምሉ። በጃኹም ደጊምኩም ፈትኑ።',
      credentials: 'ጌጋ ኢመይል ወይ መሕለፊ ቃል።',
      rate: 'ብዙሕ ፈተነታት። በጃኹም ጸኒሕኩም ፈትኑ።',
      emailSignin: 'ናይ ምእታው ሊንክ ክንሰድድ ኣይከኣልናን። ብዙሕ ሕቶታት ተላኢኹ ክኸውን ይኽእል — ድሕሪ ቁሩብ ደቓይቕ ደጊምኩም ፈትኑ።',
      generic: 'ኣብ ምእታው ገለ ጌጋ ተፈጢሩ። በጃኹም ደጊምኩም ፈትኑ።',
    },
  },
  checkEmail: {
    title: 'ኢመይልኩም ርኣዩ',
    body: 'ናይ ምእታው ሊንክ ሰዲድናልኩም። ናብ ኣፕሊኬሽን ንምእታው ጠውቕዎ። እቲ ሊንክ ን24 ሰዓት ይሰርሕ።',
    devHint: 'ኣብ ናይ ምምዕባል ከባቢ — ኣብ ሎግ ሰርቨር ነዚ ድለዩ:',
    back: 'ናብ ምእታው ተመለሱ',
  },
  twoFactor: {
    title: 'ብኽልተ ስጉምቲ ምርግጋጽ',
    subtitle: 'ካብ ኣፕሊኬሽን ምርግጋጽኩም ዝመጸ 6 ኣሃዝ ዘለዎ ኮድ፡ ወይ ሓንሳብ ጥራይ ዝሰርሕ ኮድ ምምላስ ኣእትዉ።',
    error: 'እቲ ኮድ ጌጋ እዩ ወይ ግዜኡ ሓሊፉ። በጃኹም ደጊምኩም ፈትኑ።',
    codeLabel: 'ኮድ ምርግጋጽ',
    submit: 'ኣረጋግጹ',
    switchAccount: 'ብካልእ ኣካውንት እተዉ',
  },
};
