import { QuintaDb } from '../data/db';
import { validatePhoto } from '../domain/symptoms';

interface AccountDraft {
    fields: Record<string, string>;
    photo: { bytes: ArrayBuffer; name: string; type: string } | null;
}

/** Reuse Dexie, with a separate database for every authenticated mission/account. */
export async function mountAccountDrafts(): Promise<void> {
    const account = document.querySelector<HTMLElement>('.account-app')!;
    const local = new QuintaDb(`quinta-account-${account.dataset.accountMission}-${account.dataset.accountUser}`);
    const clear = document.querySelector<HTMLElement>('[data-clear-account-draft]');
    if (clear) await local.kv.delete(['global', `draft-${clear.dataset.clearAccountDraft}`]);
    const form = document.querySelector<HTMLFormElement>('form[data-account-draft]');
    if (!form) { local.close(); return; }
    const status = form.querySelector<HTMLElement>('[data-draft-status]')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const photoInput = form.querySelector<HTMLInputElement>('input[name=photo]');
    const preview = form.querySelector<HTMLElement>('[data-account-preview]');
    const remove = form.querySelector<HTMLButtonElement>('[data-remove-photo]');
    const key = `draft-${form.dataset.accountDraft}`;
    let photo: AccountDraft['photo'] = null;
    let url: string | null = null;
    let writes = Promise.resolve();
    let photoRead = Promise.resolve();
    const draw = () => {
        if (url) URL.revokeObjectURL(url);
        url = photo ? URL.createObjectURL(new Blob([photo.bytes], { type: photo.type })) : null;
        if (preview) {
            preview.hidden = !photo;
            preview.querySelector('img')!.src = url ?? '';
            preview.querySelector('[data-photo-caption]')!.textContent = photo ? `${photo.name} · saved with your draft` : '';
        }
        if (remove) remove.hidden = !photo;
    };
    const capture = (): AccountDraft => {
        const fields: Record<string, string> = {};
        new FormData(form).forEach((v,k) => { if (typeof v === 'string' && !['_token','_method'].includes(k)) fields[k] = v; });
        return { fields, photo };
    };
    const persist = () => {
        const draft = capture();
        writes = writes.then(async () => {
            await local.kv.put({ ws: 'global', key, value: draft });
            status.textContent = 'Draft saved on this device · not yet available to your medical officer';
        }).catch(() => { status.textContent = 'Draft could not be saved locally. Keep this page open or submit while connected to the onboard server.'; });
    };
    submit.disabled = true;
    try {
        const saved = (await local.kv.get(['global',key]))?.value as AccountDraft | undefined;
        if (saved) {
            for (const [k,v] of Object.entries(saved.fields)) {
                const field = form.elements.namedItem(k);
                if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = v;
            }
            photo = saved.photo; draw();
        }
        persist();
    } catch { status.textContent = 'Local drafts are unavailable in this browser. You can still submit to the onboard server.'; }
    submit.disabled = false;
    form.addEventListener('input', (event) => {
        if ((event.target as HTMLInputElement).type !== 'file') persist();
    });
    form.addEventListener('change', (event) => {
        const el = event.target as HTMLInputElement;
        if (el.type !== 'file') { persist(); return; }
        const file = el.files?.[0];
        if (!file) return;
        const error = validatePhoto(file);
        if (error) { status.textContent = error; el.value = ''; return; }
        submit.disabled = true;
        photoRead = photoRead.then(async () => {
            photo = { bytes: await file.arrayBuffer(), name: file.name, type: file.type };
            if (photoInput) photoInput.value = '';
            el.value = '';
            draw(); persist();
        }).catch(() => { status.textContent = 'The photo could not be read. Your text is kept. Choose it again.'; }).finally(() => { submit.disabled = false; });
    });
    remove?.addEventListener('click', () => { photo = null; if (photoInput) photoInput.value = ''; draw(); persist(); });
    // FormData also fires during capture(). Only append files during actual submission.
    let sending = false;
    form.addEventListener('submit', () => { sending = true; });
    form.addEventListener('formdata', event => {
        if (!sending) return;
        const data = (event as FormDataEvent).formData;
        if (photo) data.set('photo', new File([photo.bytes], photo.name, { type: photo.type }));
        else data.delete('photo');
    });
}
