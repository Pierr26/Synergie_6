/** Minimal safe templating: every interpolated value is escaped unless it is already Html. */
export class Html {
    constructor(public readonly value: string) {}
    toString(): string {
        return this.value;
    }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function part(v: unknown): string {
    if (v === null || v === undefined || v === false) return '';
    if (v instanceof Html) return v.value;
    if (Array.isArray(v)) return v.map(part).join('');
    return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
    return new Html(out);
}

export const raw = (s: string): Html => new Html(s);

export function when(cond: unknown, a: () => Html, b?: () => Html): Html {
    return cond ? a() : b ? b() : raw('');
}
