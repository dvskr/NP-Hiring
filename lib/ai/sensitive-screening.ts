/**
 * Screening questions the assistant connectors will not collect answers to,
 * or relay.
 *
 * Health and disability, criminal history, identity numbers and protected
 * characteristics are restricted data for both assistant directories, and an
 * employer may still ask them on the website, where the candidate answers
 * them directly. When a job asks one, the assistant sends the candidate to
 * the site to finish instead of relaying the answer.
 *
 * The test is whether a question asks about the candidate as a person. A
 * question about their clinical work is never sensitive, and on a clinical
 * board that is most questions: the patients they treat and the care they
 * give are the job.
 */
const SENSITIVE_QUESTION_PATTERNS: readonly RegExp[] = [
  // The candidate's own health. "Medical" alone is not here: "an active
  // medical license" is an ordinary credential question.
  /\b(do you have|have you (ever )?had) (a |any )?(disabilit|medical condition|health condition|chronic (illness|condition))/i,
  /\bhave you (ever )?been (diagnosed|hospitali[sz]ed)\b/i,
  /\b(are you|currently) (taking|on) (any )?(medications?|prescriptions?)\b/i,
  /\byour (own )?(health|medical|mental\s+health) (condition|history|status|record)/i,
  /\b(disability status|medical leave|pregnan(t|cy) status|are you pregnant|vaccinat|immuni[sz]ation|hiv (status|positive))/i,
  // Criminal history. Consent to a background check is not a disclosure.
  /\b(criminal|convicted|conviction|felon|misdemeanor|arrested)/i,
  // Government identifiers and identity documents.
  /\b(social security|ssn\b|date of birth|birth ?date|passport)/i,
  // The number, not the credential: "do you hold an active DEA registration"
  // is a normal yes/no question; "your DEA registration number" is not.
  /\b(dea|npi)\b[\w\s]{0,24}?(number|#)/i,
  /\blicen[cs]e\b[\w\s]{0,24}?(number|#)/i,
  // Protected characteristics. Work authorization and visa sponsorship are
  // lawful to ask and stay allowed; citizenship itself is not.
  /\b(race|ethnicity|religion|religious|sexual orientation|gender identity|national origin|veteran status|marital status|citizenship|immigration status)\b/i,
  /\b(how old are you|your age|your (gender|sex|race|ethnicity|pronouns))\b/i,
  /\bare you (a |an )?(protected |u\.?s\.? )?(veteran|hispanic|latin[oax]|citizen|transgender|disabled)\b/i,
  // The one-word questions of an equal opportunity form.
  /^\s*(gender|sex|race|ethnicity|pronouns|veteran|disability)\s*[:?]?\s*$/i,
];

export function isSensitiveScreeningQuestion(text: string): boolean {
  return SENSITIVE_QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}
