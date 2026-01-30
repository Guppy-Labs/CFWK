export class EmojiMap {
    private static readonly map: Record<string, string> = {
        ':)': '🙂',
        ':D': '😃',
        ':(': '🙁',
        ';)': '😉',
        ':P': '😛',
        ':p': '😛',
        '<3': '❤️',
        '</3': '💔',
        ':heart:': '❤️',
        ':joy:': '😂',
        ':sob:': '😭',
        ':fire:': '🔥',
        ':thumbsup:': '👍',
        ':thumbsdown:': '👎',
        ':ok_hand:': '👌',
        ':wave:': '👋',
        ':rofl:': '🤣',
        ':cool:': '😎',
        ':smirk:': '😏',
        ':neutral:': '😐',
        ':expressionless:': '😑',
        ':unamused:': '😒',
        ':thinking:': '🤔',
        ':zipper_mouth:': '🤐',
        ':angry:': '😠',
        ':rage:': '😡',
        ':skull:': '💀',
        ':poop:': '💩',
        ':clown:': '🤡',
        ':ghost:': '👻',
        ':alien:': '👽',
        ':robot:': '🤖',
        ':party:': '🥳',
        ':sunglasses:': '😎',
        ':heart_eyes:': '😍',
        ':star_struck:': '🤩',
        ':sleeping:': '😴',
        ':money_mouth:': '🤑',
        ':nerd:': '🤓',
        ':confused:': '😕',
        ':scream:': '😱',
        ':sweat_smile:': '😅',
        ':100:': '💯',
        ':check:': '✅',
        ':x:': '❌'
    };

    // Cached regex for faster replacement
    private static regex: RegExp | null = null;

    static parse(text: string): string {
        if (!text) return text;
        
        if (!this.regex) {
            // Sort keys by length descending to ensure longer matches (like :party:) 
            // take precedence over shorter prefixes (like :p)
            const sortedKeys = Object.keys(this.map).sort((a, b) => b.length - a.length);
            
            // Escape special regex chars in keys (like (, ), +, etc)
            const pattern = sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            this.regex = new RegExp(pattern, 'g');
        }
        
        return text.replace(this.regex, (match) => this.map[match]);
    }
}
