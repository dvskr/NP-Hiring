/**
 * How the inbox and a thread name the other participant: by name, then by
 * company, then "User".
 *
 * SECURITY: never by email address. The routes used to show the start of the
 * address of a person with no name and no company; they no longer read it.
 * tests/api/conversations-deleted-and-unnamed.test.ts
 *
 * `showSurname: false` (surname-disclosure.ts) gives first name and last
 * initial, as the talent pool does, and never falls back to the company.
 */
export interface NamedPerson {
    readonly firstName: string | null;
    readonly lastName: string | null;
}

/** Full name, or first name and last initial without the surname; '' with no name to show. */
export function personName(person: NamedPerson, showSurname: boolean): string {
    if (showSurname) return [person.firstName, person.lastName].filter(Boolean).join(' ');
    if (!person.firstName) return '';
    return person.lastName ? `${person.firstName} ${person.lastName.charAt(0)}.` : person.firstName;
}

export function participantDisplay(
    user: NamedPerson & { readonly company: string | null },
    { showSurname = true }: { showSurname?: boolean } = {},
): { name: string; initials: string } {
    const name = personName(user, showSurname) || (showSurname ? user.company : null) || 'User';
    const initials = user.firstName
        ? `${user.firstName.charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase()
        : name.charAt(0).toUpperCase();
    return { name, initials };
}
