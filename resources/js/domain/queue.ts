export type QueueState = 'not-queued' | 'queued' | 'sending' | 'received' | 'retry';

export const QUEUE_LABEL: Record<QueueState, string> = {
    'not-queued': 'Not queued',
    queued: 'Queued',
    sending: 'Sending',
    received: 'Received',
    retry: 'Retry available',
};

export type ReceiverId = 'simulated-ground' | 'laravel-test';

export const RECEIVER_LABEL: Record<ReceiverId, string> = {
    'simulated-ground': 'Simulated ground receiver',
    'laravel-test': 'MongoDB Atlas ground receiver',
};

export interface Receipt {
    reportId: string;
    receiptId: string;
    receiver: string;
    receivedAt: string;
    sha256: string;
    replayed: boolean;
}

export interface QueueAttempt {
    at: string;
    outcome: 'sent' | 'received' | 'failed';
    detail: string;
}

export interface QueueInfo {
    state: QueueState;
    receiver: ReceiverId | null;
    queuedAt: string | null;
    attempts: QueueAttempt[];
    receipt: Receipt | null;
}

export const EMPTY_QUEUE: QueueInfo = { state: 'not-queued', receiver: null, queuedAt: null, attempts: [], receipt: null };

export function enqueue(q: QueueInfo, receiver: ReceiverId, at: string): QueueInfo {
    if (q.state !== 'not-queued') return q;
    return { ...q, state: 'queued', receiver, queuedAt: at };
}

export function startSending(q: QueueInfo, at: string): QueueInfo {
    if (q.state !== 'queued' && q.state !== 'retry') return q;
    return { ...q, state: 'sending', attempts: [...q.attempts, { at, outcome: 'sent', detail: 'Transmission started' }] };
}

/** Only an acknowledgement from the selected receiver can mark the report Received. */
export function acknowledge(q: QueueInfo, receipt: Receipt, at: string): QueueInfo {
    if (q.state !== 'sending') return q;
    if (q.receiver === null || receipt.receiver !== RECEIVER_LABEL[q.receiver]) return fail(q, at, 'Acknowledgement from an unexpected receiver ignored');
    return { ...q, state: 'received', receipt, attempts: [...q.attempts, { at, outcome: 'received', detail: `Receipt ${receipt.receiptId.slice(0, 8)}` }] };
}

export function fail(q: QueueInfo, at: string, detail: string): QueueInfo {
    if (q.state !== 'sending') return q;
    return { ...q, state: 'retry', attempts: [...q.attempts, { at, outcome: 'failed', detail }] };
}

/** Retry keeps the same destination; the report keeps its UUID and frozen content. */
export function retry(q: QueueInfo): QueueInfo {
    if (q.state !== 'retry') return q;
    return { ...q, state: 'queued' };
}

/** Canonical JSON: sorted keys, no whitespace. Same snapshot → same bytes → same hash. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
        .join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
