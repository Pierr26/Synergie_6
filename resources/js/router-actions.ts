export type ActionFn = (el: HTMLElement, ev: Event) => void | Promise<void>;

/** Registry for delegated handlers: data-action="name" on buttons, forms and inputs; data-mount="name" after render. */
export const actions: Record<string, ActionFn> = {};

export function registerActions(map: Record<string, ActionFn>): void {
    Object.assign(actions, map);
}
