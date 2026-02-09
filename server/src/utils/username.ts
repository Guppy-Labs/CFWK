export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 16;
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function normalizeUsername(username: string): string {
    return username.trim();
}

export function getUsernameValidationError(username: string): string | null {
    if (typeof username !== "string") return "Invalid username";
    if (/\s/.test(username)) return "Username can only contain letters, numbers, and underscores.";
    const trimmed = normalizeUsername(username);
    if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
        return `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
        return "Username can only contain letters, numbers, and underscores.";
    }
    return null;
}
