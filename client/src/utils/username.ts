const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 16;
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function getUsernameValidationError(username: string): string | null {
    if (!username) return 'Please enter a username';
    if (/\s/.test(username)) return 'Username can only contain letters, numbers, and underscores.';
    const trimmed = username.trim();
    if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
        return `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
        return 'Username can only contain letters, numbers, and underscores.';
    }
    return null;
}

export function normalizeUsername(username: string): string {
    return username.trim();
}
